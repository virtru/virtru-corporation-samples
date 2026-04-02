import React, { useEffect, useRef, useState } from 'react';
import { Chip, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import {
  Check, ExpandLess, ExpandMore,
  Flight, People, Business, Assessment, Category,
} from '@mui/icons-material';
import { useRpcClient } from '@/hooks/useRpcClient';

interface Props {
  value: string | null;
  onChange: (value: string) => void;
}

export function SourceTypeSelector({ value, onChange }: Props) {
  const chipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openMenu = () => setOpen(true);
  const closeMenu = () => setOpen(false);

  const handleSelection = (selectedType: string) =>  {
    onChange(selectedType);
    closeMenu();
  };

  const [typeList, setTypeList] = useState<string[]>([]);
  const { listSrcTypes } = useRpcClient();

  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const { srcTypes } = await listSrcTypes({});
        setTypeList(srcTypes);
      } catch (err) {
        console.error(err);
      }
    };

    fetchTypes();
  }, []);

  const iconMap: Record<string, React.ReactElement> = {
    vehicles: <Flight fontSize="small" />,
    employee: <People fontSize="small" />,
    facilities: <Business fontSize="small" />,
    facility: <Business fontSize="small" />,
    sitrep: <Assessment fontSize="small" />,
  };

  const getIcon = (type: string) => iconMap[type.toLowerCase()] || <Category fontSize="small" />;

  const label = value || 'Select Source Type';

  return (
    <>
      <Chip
        ref={chipRef}
        label={label}
        onClick={openMenu}
        onDelete={openMenu}
        deleteIcon={open ? <ExpandLess /> : <ExpandMore />}
        variant={value ? 'filled' : 'outlined'}
        color={value ? 'primary' : 'default'}
        sx={{
          height: 36,
          fontSize: '0.875rem',
          fontWeight: 600,
          textTransform: 'capitalize',
          cursor: 'pointer',
          '& .MuiChip-deleteIcon': {
            color: value ? 'rgba(255,255,255,0.7)' : 'inherit',
          },
        }}
      />
      <Menu
        anchorEl={chipRef.current}
        open={open}
        onClose={closeMenu}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 200,
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          },
        }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      >
        <Typography variant="subtitle2" sx={{ px: 2, pt: 1, pb: 0.5, color: 'text.primary', fontWeight: 700, display: 'block' }}>
          Source Types
        </Typography>
        {typeList.map(t => (
          <MenuItem
            key={t}
            onClick={() => handleSelection(t)}
            selected={value === t}
            sx={{ borderRadius: 1, mx: 0.5, textTransform: 'capitalize' }}
          >
            <ListItemIcon>{getIcon(t)}</ListItemIcon>
            <ListItemText>{t}</ListItemText>
            {value === t && <Check fontSize="small" color="primary" />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
