import { Alert, List, ListItem, ListItemText } from '@mui/material';
import { ErrorListProps, RJSFSchema, FormContextType, StrictRJSFSchema } from '@rjsf/utils';

export function ErrorListTemplate<
  T = any,
  S extends StrictRJSFSchema = RJSFSchema,
  F extends FormContextType = any,
>({ errors }: ErrorListProps<T, S, F>) {
  return (
    <Alert variant="filled" severity="error" sx={{ mt: 2 }}>
      <strong>Please fix the following errors:</strong>
      <List dense disablePadding sx={{ mt: 0.5 }}>
        {errors.map((error, i) => (
          <ListItem key={i} disableGutters sx={{ py: 0 }}>
            <ListItemText
              primary={`${error.property?.replace(/^\./, '') || 'Field'}: ${error.message}`}
              primaryTypographyProps={{ variant: 'body2', color: 'inherit' }}
            />
          </ListItem>
        ))}
      </List>
    </Alert>
  );
}
