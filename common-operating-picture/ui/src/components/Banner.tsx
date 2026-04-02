import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useContext } from 'react';
import { BannerContext, Classifications, BannerClassification } from '@/contexts/BannerContext';

export const Banner = () => {
  const theme = useTheme();
  const { activeEntitlements } = useContext(BannerContext);

  // Helper to extract the value from the FQN (e.g., 'secret')
  const getFqnValue = (fqn: string): string => (fqn || '').split('/').pop()?.toUpperCase() || '';

  const getBannerData = () => {
    const activeValues = Array.from(activeEntitlements).map(getFqnValue);

    // Highest Classification only
    const highestClass = [...Classifications]
      .reverse()
      .find(cls => activeValues.includes(cls)) || 'UNCLASSIFIED';

    const ntkCaveats: string[] = [];
    const relValues: string[] = [];

    activeEntitlements.forEach(fqn => {
      const val = getFqnValue(fqn);
      if (Classifications.includes(val)) return;

      // If the path contains 'relto', treat it as a REL TO value
      if (fqn.toLowerCase().includes('relto')) {
        relValues.push(val);
      } else {
        ntkCaveats.push(val);
      }
    });

    // Format the REL TO string with commas
    const formattedRel = relValues.length > 0
      ? `REL TO ${relValues.join(', ')}`
      : '';

    // Combine
    const allCaveats = [...ntkCaveats];
    if (formattedRel) allCaveats.push(formattedRel);

    const displayString = allCaveats.length > 0
      ? `${highestClass}//${allCaveats.join('//')}`
      : highestClass;

    return {
      label: "MAX CLASSIFICATION: " + displayString,
      color: BannerClassification[highestClass]
    };
  };

  const { label, color } = getBannerData();

  if (activeEntitlements.size === 0 || activeEntitlements.has('NoAccess')) return null;

  return (
    <Box
      sx={{
        background: color,
        color: 'white',
        zIndex: theme.zIndex.modal + 1,
        textAlign: 'center',
        fontWeight: 'bold',
        padding: '4px 0',
      }}
    >
      {label}
    </Box>
  );
};