import { ReactNode, useEffect, useState } from 'react';
import { RJSFSchema, UiSchema, WidgetProps } from '@rjsf/utils';
import { SrcType, SrcTypeUiSchema } from '@/proto/tdf_object/v1/tdf_object_pb';
import { Context, DynamicFormSchema } from './SourceTypeContext';
import { LocationAutocompleteWidget } from '@/components/JsonSchemaForm/LocationAutocompleteWidget';
import { AttributeAutocompleteWidget } from '@/components/JsonSchemaForm/AttributeAutocompleteWidget';
import { DatePickerWidget } from '@/components/JsonSchemaForm/DatePickerWidget';
import { DateTimePickerWidget } from '@/components/JsonSchemaForm/DateTimePickerWidget';
import { propertyOf } from 'lodash';

//  TODO: If using a 'key.key' query on an object, the code below may need to be updated further.

function buildUiSchema(schemaConfig?: SrcTypeUiSchema): UiSchema {
  const uiSchema: UiSchema = {
    // disable submit by default as the modal has a submit button already
    'ui:submitButtonOptions': {
      norender: true,
    },
  };

  if (schemaConfig) {
    uiSchema['ui:order'] = schemaConfig.order;

    for (const field of Object.keys(schemaConfig.fieldConfig)) {
      uiSchema[field] = {};

      const { widget, placeholder, multiple } = schemaConfig.fieldConfig[field];

      if (placeholder) {
        uiSchema[field]['ui:placeholder'] = placeholder;
      }

      if (multiple) {
        uiSchema[field]['ui:options'] = {
          multiple: true,
        };
      }

      let uiWidget: string | ((props: WidgetProps) => JSX.Element);
      switch (widget) {
        case 'LocationAutocomplete':
          uiWidget = LocationAutocompleteWidget;
          break;
        case 'AttributeAutocomplete':
          uiWidget = AttributeAutocompleteWidget;
          break;
        case 'DatePicker':
          uiWidget = DatePickerWidget;
          break;
        default:
          uiWidget = widget;
      }

      if (uiWidget) {
        uiSchema[field]['ui:widget'] = uiWidget;
      }
    }
  }

  return uiSchema;
}

type Props = {
  children: ReactNode;
  srcType?: SrcType;
};

export function SourceTypeProvider({ children, srcType }: Props) {

  const [createFormSchema, setCreateFormSchema] = useState<DynamicFormSchema>({ form: {}, ui: {} });
  const [searchFormSchema, setSearchFormSchema] = useState<DynamicFormSchema>({ form: {}, ui: {} });

  useEffect(() => {
    if (!srcType) {
      return;
    }

    const { formSchema, uiSchema, metadata } = srcType;

    if (!formSchema) {
      // todo: show user message that source type does not have a form?
      throw new Error('SourceType does not have a form schema');
    }

    // Clone schema to safely mutate
    let createFormSchema: RJSFSchema = JSON.parse(JSON.stringify(formSchema.toJson()));

    const searchFormSchema: RJSFSchema = {
      type: 'object',
      required: ['startDate', 'endDate'],
      definitions: createFormSchema.definitions,
      properties: {
        startDate: {
          type: 'string',
          format: 'date-time',
          title: 'Start Date',
        },
        endDate: {
          type: 'string',
          format: 'date-time',
          title: 'End Date',
        },
        // pull property definitions for searchable fields
        ...(metadata?.searchFields || []).reduce((schema: any, field: string) => {
          const prop = createFormSchema.properties?.[field];

          if (!prop) {
          console.warn(`Field "${field}" is not defined in createFormSchema.properties`);
          return schema;
          }

          schema[field] = prop;
          return schema;
        }, {}),
      },
    };

    const createUiSchema = buildUiSchema(uiSchema);

    const searchUiSchema = Object.entries(createUiSchema).reduce((schema: any, [field, config]) => {
      if (field.startsWith('ui') || searchFormSchema.properties[field]) {
        schema[field] = config;
      }
      return schema;
    }, {});
    searchUiSchema['ui:order'] = ['startDate', 'endDate', ...(searchUiSchema['ui:order'] || []) ];
    searchUiSchema.startDate = {
      'ui:widget': DateTimePickerWidget,
    };
    searchUiSchema.endDate = {
      'ui:widget': DateTimePickerWidget,
    };

    setCreateFormSchema({
      form: createFormSchema,
      ui: createUiSchema,
    });

    setSearchFormSchema({
      form: searchFormSchema,
      ui: searchUiSchema,
    });

  }, [srcType]);

  if (!srcType) {
    return <>{children}</>;
  }

  const { geoField, searchFields, tsField, attrFields, displayFields, mapFields } = srcType.metadata || {};

  const value = {
    id: srcType.id,
    createFormSchema,
    searchFormSchema,
    tsField,
    geoField,
    searchFields,
    attrFields,
    displayFields,
    mapFields,
    getFieldTitle: (field: string = '') => propertyOf(createFormSchema.form.properties)(field)?.title || field.split('.').join(' '),
  };

  return (
    <Context.Provider value={value}>
      {children}
    </Context.Provider>
  );
}
