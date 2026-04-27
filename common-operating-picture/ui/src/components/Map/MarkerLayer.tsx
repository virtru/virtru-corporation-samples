import { LayerGroup, LayersControl, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { TdfObjectResponse } from '@/hooks/useRpcClient';
import { Box, Typography } from '@mui/material';
import { useSourceType } from '@/pages/SourceTypes/SourceTypeContext';
import { formatDateTime } from '@/utils/format';
import { mapColors, mapIcons, mapStringToColor, mapStringToSvgPath } from '@/pages/SourceTypes/helpers/markers';
import { propertyOf } from 'lodash';
import ms from 'milsymbol';
import { ObjectBanner } from '@/components/ObjectBanner';
import { extractValues } from '@/contexts/BannerContext';

type Props = {
  tdfObjects: TdfObjectResponse[];
  isCluster?: boolean;
  layerName: string;
};

L.Icon.Default.prototype.options.iconUrl = '/img/marker-icon.png';
L.Icon.Default.prototype.options.iconRetinaUrl = '/img/marker-icon-2x.png';
L.Icon.Default.prototype.options.shadowUrl = '/img/marker-shadow.png';
L.Icon.Default.imagePath = '';

export function MarkerLayer({ tdfObjects = [], isCluster = false, layerName = 'unnamed-layer' }: Props) {
  const { id, displayFields, mapFields, getFieldTitle } = useSourceType();

  if (!tdfObjects.length) {
      return null;
  }

  // note: render logic below is duplicated from SearchResults component due to
  // differences in component structure between map markers and accordion results display
  // todo: refactor to avoid duplication

  const renderHeader = (o: TdfObjectResponse) => {
    let formattedDateTime = 'Time Not Recorded';

    if (o.tdfObject.ts) {
      formattedDateTime = formatDateTime(o.tdfObject.ts.toDate().toISOString());
    }

    const value = propertyOf(o.decryptedData)(displayFields?.header || 'id');
    const displayValue = (typeof value === 'object' && value !== null)
      ? (value.country || value.name || "Object")
      : value;

    return (
      <Box className="tooltip-header" sx={{ mt: 1 }}>
        <Typography variant="h6" className="vehicle-name" sx={{ pr: 2 }}>
          {getFieldTitle(displayFields?.header)}: {displayValue}
        </Typography>
        <Box className="callsign-container">
          <Typography variant="caption" className="callsign-label">Time:</Typography>
          <Typography variant="caption" className="callsign-value">{formattedDateTime}</Typography>
        </Box>
      </Box>
    );
  };

  const renderDetails = (o: TdfObjectResponse) => {
    const oa = propertyOf(o.decryptedData);

    const details = (displayFields?.details || []).filter(field => !field.startsWith('attr')).map(field => {
      let value = oa(field);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = value.country || value.name || JSON.stringify(value);
      }

      return (
        <Box key={`${o.tdfObject.id}-${field}-details`} className="detail-item">
          <Typography variant="caption" className="detail-label">{getFieldTitle(field)}:</Typography>
          <Typography variant="caption" className="detail-value">{value || 'N/A'}</Typography>
        </Box>
      );
    });
    return details;
  };

  const tdfObjectToDynamicIcon = (tdfObject: TdfObjectResponse) => {
    const oa = propertyOf(tdfObject.decryptedData);
    let iconSvgPath = '';
    let iconColor = '';

    // Use Leaflet default if there is no srcType.metadata.mapFields
    if (!mapFields) {
      return L.icon({
        iconUrl: '/img/marker-icon.png',
        iconRetinaUrl: '/img/marker-icon-2x.png',
        shadowUrl: '/img/marker-shadow.png',
      });
    }

    // Handle the dynamic icon
    if (!mapFields.iconConfig || mapFields.iconConfig.length < 1){
      iconSvgPath = mapIcons[mapFields.iconDefault];
    } else {
      for(let i = 0; i<mapFields.iconConfig.length; i++){
        // which field drives the icon?
        const iconConfigField = mapFields.iconConfig[i].field;
        const iconConfigValueMap = mapFields.iconConfig[i].valueMap;

        // what is the value of that field from the data object?
        let objectConfigValueIcon = oa(iconConfigField);
        // Handle for type Array (ie: attrNeedToKnow, attrRelTo)
        if (Array.isArray(objectConfigValueIcon)) {
          // fixme: currently using the first index
          objectConfigValueIcon = objectConfigValueIcon[0];
        }

        // Map the value to the valueMap if there is a matching key, else return self
        objectConfigValueIcon = iconConfigValueMap[objectConfigValueIcon] || objectConfigValueIcon;

        // Go to the next iconConfig if the data is null or empty string
        if(!objectConfigValueIcon || objectConfigValueIcon == '') continue;

        // If valueMap contains a isMilSymbol key and the value is "true", create MilSymbol
        if(!!iconConfigValueMap.isMilSymbol && iconConfigValueMap.isMilSymbol.toLowerCase() === 'true'){
          return renderMilSymbolIcon(objectConfigValueIcon);
        }

        // Get the SVG path and break out of the loop
        iconSvgPath = mapStringToSvgPath(objectConfigValueIcon);
        if(iconSvgPath && iconSvgPath != '') break;
      }

      // If mapFields is avaiable, the computed value might still be null or empty; use default
      if(iconSvgPath == '') iconSvgPath = mapIcons[mapFields.iconDefault] || '';
    }

    // handle the dynamic color
    if (!mapFields.colorConfig || Object.keys(mapFields.colorConfig).length < 1){
      iconColor = mapColors[mapFields.colorDefault];
    } else {
      // which field drives the color?
      const iconColorField = mapFields.colorConfig[0].field;

      // what is the value of that field from the data object?
      let objectConfigValueColor = oa(iconColorField);

      // Handle for type Array (ie: attrNeedToKnow, attrRelTo)
      if (Array.isArray(objectConfigValueColor)) {
        // fixme: currently using the first index
        objectConfigValueColor = objectConfigValueColor[0];
      }
      if (objectConfigValueColor) {
        objectConfigValueColor = objectConfigValueColor.toLowerCase();
      }

      iconColor = objectConfigValueColor ? mapStringToColor(objectConfigValueColor) : mapColors[mapFields.colorDefault] || mapColors.default;
    }

    if (!iconColor){
      iconColor = mapColors.default;
    }
    if (!iconSvgPath){
      iconSvgPath = mapIcons.default;
    }

    return renderDynamicIcon(iconSvgPath, iconColor);
  };

  const renderMilSymbolIcon = (milSymbol: string) => {
    const dpi = window.devicePixelRatio || 1;
    const size = 12 * dpi;

    const symbol = new ms.Symbol(milSymbol, { size: size });
    const canvas = symbol.asCanvas();
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.scale(dpi, dpi);
    } else {
      console.error('Error creating icon');
    }

    return L.icon({
      iconUrl: canvas.toDataURL(),
      // iconSize: [size, size],
      iconAnchor: new L.Point(symbol.getAnchor().x, symbol.getAnchor().y),
    });
  };

  const renderDynamicIcon = (iconSvgPath: string, iconColor: string) => {
    const canvas = document.createElement('canvas');
    const dpi = window.devicePixelRatio || 1;
    const size = 32 * dpi;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.scale(dpi, dpi);
      // NOTE: iconColor can be a string or hex code: '#3898ec' or 'blue'
      ctx.fillStyle = iconColor;
      const path = new Path2D(iconSvgPath);
      ctx.fill(path);
    }
    else {
      console.error('Error creating icon');
    }
    return L.icon({
      iconUrl: canvas.toDataURL(),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  };

  const renderMarker = (tdfObject: TdfObjectResponse) => {
      // NOTE: tdfObject provides coordinates as long/lat, but Leaflet expects coordinates as lat/long
      const coordinates = JSON.parse(tdfObject.tdfObject.geo).coordinates;
      const dynamicTdfIcon = tdfObjectToDynamicIcon(tdfObject);

      const data = tdfObject.decryptedData || {};

      const objClass = extractValues(data.attrClassification || [])
        .split(', ')
        .filter(Boolean);

      const objNTK = extractValues(data.attrNeedtoknow || data.attrNeedToKnow || [])
        .split(', ')
        .filter(Boolean);

      const objRel = extractValues(data.attrRelto || data.attrRelTo || [])
        .split(', ')
        .filter(Boolean);

      return (
        <Marker position={{ lat: coordinates[1], lng: coordinates[0] }} key={tdfObject.tdfObject.id} icon={dynamicTdfIcon}>
          <Popup minWidth={340} maxWidth={400} offset={[0, -15]} className="custom-vehicle-popup" closeButton={false}>
            <Box className="tooltip-container" sx={{ position: 'relative', paddingBottom: '4px', maxHeight: '70vh', overflowY: 'auto' }}>
              <ObjectBanner
                objClassification={objClass.length > 0 ? objClass : ['UNCLASSIFIED']}
                objNTK={objNTK}
                objRel={objRel}
                notes={[]}
              />
              {renderHeader(tdfObject)}
              <Box className="tooltip-section">
                <Typography variant="body2" className="section-title">Details</Typography>
                {renderDetails(tdfObject)}
              </Box>
            </Box>
          </Popup>
        </Marker>
      );
  };

  if (isCluster) {
    return (
      <>
        {tdfObjects.map(o => renderMarker(o))}
      </>
    );
  } else {
    return (
        // NOTE: LayersControl is not rendered here becuase it is the parent element for ALL layers
      <LayersControl.Overlay checked name={layerName} key={id}>
        <LayerGroup>
          {tdfObjects.map(o => renderMarker(o))}
        </LayerGroup>
      </LayersControl.Overlay>
    );
  }
}