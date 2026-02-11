import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { LatLng } from 'leaflet';
import { Accordion, AccordionDetails, AccordionSummary, Autocomplete, Box, Button, Chip,
  IconButton, TextField, Stack, Typography, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { ExpandMore, GpsFixed } from '@mui/icons-material';
import { TdfObjectResponse, TdfNotesResponse, useRpcClient } from '@/hooks/useRpcClient';
import { useSourceType } from './SourceTypeContext';
import { formatDateTime } from '@/utils/format';
import { propertyOf } from 'lodash';
import { CreateTdfNoteRequest } from '@/proto/tdf_object/v1/tdf_note_pb';
import { PartialMessage } from '@bufbuild/protobuf';
import { useTDF } from '@/hooks/useTdf';
import { BannerContext, extractValues } from '@/contexts/BannerContext';
import { checkNoteEntitlements, checkRelToEntitlements, reltoMap } from '@/utils/attributes';
import { ObjectBanner } from '@/components/ObjectBanner';

// Note data structure to pass note attributes back to parent
interface NoteAttributeData {
  noteId: string;
  searchAttributes: string;
}

// TDF Object search attributes
interface TDFObjectSearchAttributes {
  attrClassification?: string[];
  attrNeedtoknow?: string[];
  attrRelto?: string[];
}

// New component props
type Props = {
  tdfObjectResponse: TdfObjectResponse;
  categorizedData: Record<string, string[]>;
  onFlyToClick: (location: LatLng) => void;
  onNotesUpdated: (objectId: string, notes: NoteAttributeData[]) => void;
  notesOnly?: boolean; // When true, only show notes section without vehicle details
};

export function TdfObjectResult({ tdfObjectResponse: o, categorizedData, onFlyToClick, onNotesUpdated, notesOnly = false }: Props) {
  const { displayFields, getFieldTitle } = useSourceType();
  const { encrypt } = useTDF();
  const { createNoteObject, queryNotes } = useRpcClient();
  const { activeEntitlements } = useContext(BannerContext);
  // Isolated note text box state
  const [noteText, setNoteText] = useState('');
  // Isolated state for managing dropdown selections
  const [localSelectedValues, setLocalSelectedValues] = useState<{ [key: string]: string | string[] }>({});
  // Isolated state for note results for this object
  const [objectNotes, setObjectNotes] = useState<TdfNotesResponse[]>([]);
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const prevObjectId = useRef<string | null>(null);
  // fetchNotes given objectId
  const fetchNotes = useCallback(async (objectId: string, isNoteSubmission = false) => {

  // Skip refetch if same objectId and not a note submission to prevent unnecessary/looping calls
  if (objectId === prevObjectId.current && !isNoteSubmission) return;

  // Update previous objectId reference
  if (!isNoteSubmission) {
    prevObjectId.current = objectId;
    setIsLoading(true);
  }

  try {
    //console.log(`Fetching notes for object ID: ${objectId}`);
    const notes = await queryNotes({ parentId: objectId });

    // Filter notes for attributes not in activeEntitlements
    const filteredNotes = notes.filter(note => {
              // Keep the queried note if it does not contain unavailable attributes
              return !checkNoteEntitlements(note, activeEntitlements);
          });

    setObjectNotes(filteredNotes);
    //console.log("Fetched notes: ", notes);

    // Map notes to the simpler structure for parent
    const noteAttributes = filteredNotes.map(note => ({
      noteId: note.tdfNote.id,
      searchAttributes: note.tdfNote.search,
    }));

    // Pass notes back to parent
    onNotesUpdated(objectId, noteAttributes);
  } catch (error) {
    console.error('Error fetching notes:', error);
  } finally {
    setIsLoading(false); // End loading
  }
}, [queryNotes, onNotesUpdated]);

  // Initial fetch on mount or if the tdfObject changes
  useEffect(() => {
    fetchNotes(o.tdfObject.id);
  }, [o.tdfObject.id, fetchNotes]);

  const handleFlyToClick = () => {
    const coordinates = JSON.parse(o.tdfObject.geo).coordinates;
    // NOTE: tdfObject provides coordinates as long/lat, but Leaflet expects coordinates as lat/long
    onFlyToClick(new LatLng(coordinates[1], coordinates[0]));
  };

  // Only updates the local note text state
  const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNoteText(e.target.value);
  };

  // Handles dropdown changes for local state
  const handleDropdownChange = (category: string, value: string | string[]) => {
    setLocalSelectedValues((prevValues) => ({
      ...prevValues,
      [category]: value,
    }));
  };

    // Submits the note along with selected attributes
  // Submits the note along with selected attributes
  const handleNoteSubmit = async () => {
    // Validation Checks
    // Ensure note text is not empty and classification is selected if required
    const trimmedNoteText = noteText.trim();
    const classificationSelected = localSelectedValues['classification'];

    if (!trimmedNoteText) {
      window.alert('Note Submission Error: Note needs to have text, cannot be empty.');
      return;
    }

    const hasClassificationEntitlements = Object.keys(categorizedData).includes('classification');
    if (hasClassificationEntitlements && !classificationSelected) {
      window.alert('Note Submission Error: Must have a classification attribute selected.');
      return;
    }

    // Prepare an object to store the attributes for encryption
    const attrs: { [key: string]: string[] } = {
      attrClassification: [],
      attrNeedtoknow: [],
      attrRelto: [],
    };

    // Loop through each category and populate attrs based on local selections
    Object.keys(categorizedData).forEach((category) => {
      const selectedValue = localSelectedValues[category];
      if (!selectedValue) return;

      // Get the selected value for the category from selectedValues
      const categoryKey = `attr${category.charAt(0).toUpperCase() + category.slice(1)}`;

      // Handle both single and multiple selections
      const valuesToProcess = Array.isArray(selectedValue) ? selectedValue : [selectedValue];

      if (attrs[categoryKey]) {
        valuesToProcess.forEach(val => {
          // Check if it's relto to apply the specific format
          if (category.toLowerCase() === 'relto') {
            // Force lowercase for the value in the URL
            attrs[categoryKey].push(`https://demo.com/attr/relto/value/${val.toLowerCase()}`);
          } else {
            attrs[categoryKey].push(`https://demo.com/attr/${category}/value/${val}`);
          }
        });
      }
    });

    // Check entitlements for the selected relTo before submission
    if (checkRelToEntitlements(attrs.attrRelto, activeEntitlements)) {
      window.alert('You do not have the required RelTo entitlements to submit this note.');
      return;
    }

    // Encrypt and submit
    const tdfBlob = await encrypt(JSON.stringify(trimmedNoteText), Object.values(attrs).flat());

    // Ensure search is either a valid stringified object or null if empty
    const search = Object.keys(attrs).some(key => attrs[key].length > 0) ? JSON.stringify(attrs) : '';

    const tdfNote: PartialMessage<CreateTdfNoteRequest> = {
      parentId: o.tdfObject.id,
      search: search,
      tdfBlob: new Uint8Array(tdfBlob),
    };

    // Create the note (submit)
    await createNoteObject(tdfNote);

    // Re-fetch notes and update parent
    setNoteText(''); // Clear text box
    setLocalSelectedValues({}); // Reset dropdown selections to empty

    // Must indicate that this fetch is due to a note submission
    await fetchNotes(o.tdfObject.id, true);
  };

  // Render Functions
  const renderHeader = () => {
    let formattedDateTime = 'Time Not Recorded';
    if (o.tdfObject.ts) {
      formattedDateTime = formatDateTime(o.tdfObject.ts.toDate().toISOString());
    }
    const value = propertyOf(o.decryptedData)(displayFields?.header || 'id');
    return (
      <Stack direction="column">
        <Typography variant="h6" sx={{ wordBreak: 'break-all' }}>
          {getFieldTitle(displayFields?.header || 'id')}: {value}
        </Typography>
        <Typography variant="body1">{formattedDateTime}</Typography>
      </Stack>
    );
  };

  const renderDetailsAndNotes = () => {
    const details = notesOnly ? null : (displayFields?.details || []).map((field) => {
      let value = propertyOf(o.decryptedData)(field);
      if (typeof value === 'object' && value !== null) {
        if ('country' in value) {
          value = value.country;
        } else {
          value = JSON.stringify(value);
        }
      }
      return (
        <Box key={`${o.tdfObject.id}-${field}-details`} sx={{ wordBreak: 'break-all' }}>
          <strong>{getFieldTitle(field)}</strong>: {value}
        </Box>
      );
    });

    const extractAndJoin = (attrArray: string[] | undefined, prefix: string = ''): string => {
        if (!attrArray || attrArray.length === 0) return '';
        const values = attrArray.map(attrUrl => attrUrl.split('/').pop()).filter(v => v && v.trim() !== '');
        return values.length > 0 ? `${prefix}${values.join(' // ')}` : '';
    };

    const notes = objectNotes.length > 0 ? (
      objectNotes.map((note, index) => {
        let parsedNote: TDFObjectSearchAttributes = {};
        try {
          parsedNote = JSON.parse(note.tdfNote.search);
        } catch (e) {
          console.error('Failed to parse note:', e);
        }

        const classificationControl = extractAndJoin(parsedNote.attrClassification);
        const needToKnowControls = extractAndJoin(parsedNote.attrNeedtoknow, classificationControl ? ' // ' : '');
        const relToPrefix = (classificationControl || needToKnowControls) ? ' // rel to ' : parsedNote.attrRelto?.length ? 'rel to ' : '';
        const relToControls = extractAndJoin(parsedNote.attrRelto, relToPrefix);

        // Concatenate all parts for the final display
        const controlsDisplay = `${classificationControl}${needToKnowControls}${relToControls}`;

        return (
          <Box key={`${o.tdfObject.id}-note-${index}`} sx={{ wordBreak: 'break-all', marginTop: 2, p: 1.5, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 }}>
            <Typography variant="body1" sx={{ fontWeight: 600, color: 'white', mb: 0.5 }}>Note {index + 1}: {note.decryptedData}</Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              <strong>Control Set:</strong> {controlsDisplay}
            </Typography>
          </Box>
        );
      })
    ) : (
      <Box sx={{ marginTop: 2, p: 1.5, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
        <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>No notes available for this object</Typography>
      </Box>
    );

    return (<>{details}{notes}</>);
  };

  const objClass = extractValues(o.decryptedData.attrClassification || []).split(', ');
  const objNTK = extractValues(o.decryptedData.attrNeedToKnow || []).split(', ');
  const objRel = extractValues(o.decryptedData.attrRelTo || []).split(', ');

  if (isLoading) {
    return null;
  }

  // Simplified view for sidebar - only notes, no vehicle details
  if (notesOnly) {
    return (
      <Box key={o.tdfObject.id}>
        <ObjectBanner
          objClassification={objClass}
          objNTK={objNTK}
          objRel={objRel}
          notes={objectNotes}
        />
        {renderDetailsAndNotes()}
        <Box sx={{ mt: 2 }}>
          <TextField
            label="Add Note"
            value={noteText}
            onChange={handleNoteChange}
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            sx={{ 
              mb: 2,
              '& .MuiOutlinedInput-root': {
                color: 'white',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                '&.Mui-focused fieldset': { borderColor: 'primary.main' },
              },
              '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.7)' },
              '& .MuiInputLabel-root.Mui-focused': { color: 'primary.main' },
            }}
          />
          <Button
            onClick={handleNoteSubmit}
            variant="contained"
            color="primary"
            sx={{ width: '100%' }}
            disabled={!noteText.trim()}
          >
            Save Note
          </Button>
        </Box>

        {/* Dynamic Dropdowns */}
        <Box sx={{ mt: 2 }}>
          {Object.keys(categorizedData).map((category) => {
            const isRelTo = category.toLowerCase() === 'relto';
            const isMultiSelect = category === 'needtoknow' || isRelTo;
            const options = isRelTo ? Object.keys(reltoMap) : categorizedData[category];
            const currentValue = localSelectedValues[category] || (isMultiSelect ? [] : '');

            const darkInputStyles = {
              '& .MuiOutlinedInput-root': {
                color: 'white',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                '&.Mui-focused fieldset': { borderColor: 'primary.main' },
              },
              '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.7)' },
              '& .MuiInputLabel-root.Mui-focused': { color: 'primary.main' },
              '& .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.7)' },
            };

            if (isMultiSelect) {
              return (
                <Box key={category} sx={{ mb: 2 }}>
                  <Autocomplete
                    multiple
                    options={options}
                    getOptionLabel={(option) => isRelTo ? reltoMap[option]?.label || option : option}
                    value={Array.isArray(currentValue) ? currentValue : []}
                    onChange={(_, newValue) => handleDropdownChange(category, newValue)}
                    sx={darkInputStyles}
                    renderInput={(params) => (
                      <TextField {...params} variant="outlined" label={category.charAt(0).toUpperCase() + category.slice(1)} placeholder="Select..." />
                    )}
                    renderTags={(tagValue, getTagProps) =>
                      tagValue.map((option, index) => (
                        <Chip label={isRelTo ? reltoMap[option]?.label || option : option} {...getTagProps({ index })} size="small" sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.5)' }} />
                      ))
                    }
                  />
                </Box>
              );
            }

            return (
              <Box key={category} sx={{ mb: 2 }}>
                <FormControl fullWidth variant="outlined" sx={darkInputStyles}>
                  <InputLabel>{category.charAt(0).toUpperCase() + category.slice(1)}</InputLabel>
                  <Select
                    label={category.charAt(0).toUpperCase() + category.slice(1)}
                    value={currentValue}
                    onChange={(e) => handleDropdownChange(category, e.target.value as string)}
                  >
                    {options.map((key) => (
                      <MenuItem key={key} value={key}>{key}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  return (
    <Accordion key={o.tdfObject.id} sx={{ mb: 2 }} defaultExpanded={false}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ width: '100%' }}>
          <ObjectBanner
            objClassification={objClass}
            objNTK={objNTK}
            objRel={objRel}
            notes={objectNotes}
          />
          {renderHeader()}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {renderDetailsAndNotes()}
        <Box sx={{ mt: 2 }}>
          <TextField
            label="Add Note"
            value={noteText}
            onChange={handleNoteChange}
            fullWidth
            multiline
            rows={4}
            variant="outlined"
            sx={{ mb: 2 }}
          />
          <Button
            onClick={handleNoteSubmit}
            variant="contained"
            color="primary"
            sx={{ width: '100%' }}
            disabled={!noteText.trim()}
          >
            Save Note
          </Button>
        </Box>

        {/* Dynamic Dropdowns */}
        <Box sx={{ mt: 2 }}>
          {Object.keys(categorizedData).map((category) => {
            const isRelTo = category.toLowerCase() === 'relto';
            const isMultiSelect = category === 'needtoknow' || isRelTo;
            const options = isRelTo ? Object.keys(reltoMap) : categorizedData[category];
            const currentValue = localSelectedValues[category] || (isMultiSelect ? [] : '');

            if (isMultiSelect) {
              return (
                <Box key={category} sx={{ mb: 2 }}>
                  <Autocomplete
                    multiple
                    options={options}
                    getOptionLabel={(option) => isRelTo ? reltoMap[option]?.label || option : option}
                    value={Array.isArray(currentValue) ? currentValue : []}
                    onChange={(_, newValue) => handleDropdownChange(category, newValue)}
                    renderInput={(params) => (
                      <TextField {...params} variant="outlined" label={category.charAt(0).toUpperCase() + category.slice(1)} placeholder="Select..." />
                    )}
                    renderTags={(tagValue, getTagProps) =>
                      tagValue.map((option, index) => (
                        <Chip label={isRelTo ? reltoMap[option]?.label || option : option} {...getTagProps({ index })} size="small" />
                      ))
                    }
                  />
                </Box>
              );
            }

            return (
              <Box key={category} sx={{ mb: 2 }}>
                <FormControl fullWidth variant="outlined">
                  <InputLabel>{category.charAt(0).toUpperCase() + category.slice(1)}</InputLabel>
                  <Select
                    label={category.charAt(0).toUpperCase() + category.slice(1)}
                    value={currentValue}
                    onChange={(e) => handleDropdownChange(category, e.target.value as string)}
                  >
                    {options.map((key) => (
                      <MenuItem key={key} value={key}>{key}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            );
          })}
        </Box>

        <IconButton title="Show on map" sx={{ paddingLeft: 0, paddingBottom: 0 }} onClick={handleFlyToClick}>
          <GpsFixed />
        </IconButton>
      </AccordionDetails>
    </Accordion>
  );
}
