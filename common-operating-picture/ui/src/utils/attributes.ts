// For demo purposes in COP, we will read in the sample federal policy from the
// same YAML provisioned into the DSP policy database.
// @ts-expect-error TS2307 - policy yaml schema is enforced by DSP and should not be defined in frontend
import { attributes as policy } from '@root/config/samples/sample.federal_policy.yaml';
import { IChangeEvent } from '@rjsf/core';
import { RJSFSchema } from '@rjsf/utils';
import { ClassificationPriority, extractValues } from '@/contexts/BannerContext';
import { TdfObjectResponse, TdfNotesResponse } from '@/hooks/useRpcClient';

const namespace = policy[0].namespace;

export const extractAttributeValueFromFqn = (fqn: string): string => {
    const value = fqn.split('/').pop();
    return (value || '').toUpperCase();
};

interface TDFObjectSearchAttributes {
  attrClassification?: string[];
  attrNeedtoknow?: string[];
  attrRelto?: string[];
}

export const checkObjectEntitlements = (tdfObject: TdfObjectResponse, activeEntitlements: Set<string>): boolean => {
    // Get the raw attribute data from the object
    const classification = tdfObject.decryptedData.attrClassification;
    const needToKnow = tdfObject.decryptedData.attrNeedToKnow || [];
    const relTo = tdfObject.decryptedData.attrRelTo || [];

    // Process and split attributes into arrays
    const splitValues = (val: any) => extractValues(val).split(', ').filter(v => v.trim() !== '');

    const objClassification = splitValues(classification);
    const objNeedToKnows = splitValues(needToKnow);
    const objRelTo = splitValues(relTo);

    // Prepare user entitlements
    const trimmedEntitlements = new Set(
        [...activeEntitlements].map(extractAttributeValueFromFqn)
    );

    // All of check (Classification & Need To Know)
    // User must have every single one of these attributes.
    const allofAttributes = [...objClassification, ...objNeedToKnows];
    for (const attr of allofAttributes) {
        if (!trimmedEntitlements.has(attr.toUpperCase())) {
            return true; // Fail due to missing a required all of attribute
        }
    }

    // "any of" check for RelTo
    // If RelTo attributes exist, the user only needs to match ONE.
    if (objRelTo.length > 0) {
        const hasAtLeastOneRelTo = objRelTo.some(rel =>
            trimmedEntitlements.has(rel.toUpperCase())
        );

        if (!hasAtLeastOneRelTo) {
            return true; // Fail if user does not match any of the RelTo values
        }
    }

    return false; // Success: All checks passed
};

export const checkNoteEntitlements = (tdfNote: TdfNotesResponse, activeEntitlements: Set<string>): boolean => {

    let searchAttributes: TDFObjectSearchAttributes = {
        attrClassification: [],
        attrNeedtoknow: [],
        attrRelto: []
    };

    try {
        // Parse the JSON string from tdfNote.search
        searchAttributes = JSON.parse(tdfNote.tdfNote.search || '{}');
    } catch (e) {
        console.error("Failed to parse note search attributes for entitlement check:", e);
        return true;
    }

    const extractNoteAttr = (attrArray: string[] | undefined): string[] => {
        if (!attrArray || attrArray.length === 0) return [];
        return attrArray.map((attrUrl: string) =>
            attrUrl.split('/').pop()?.toUpperCase() || ''
        ).filter(v => v.trim() !== '');
    };

    // Prepare the user's entitlements (normalized to uppercase)
    const trimmedEntitlements = new Set(
        [...activeEntitlements].map(extractAttributeValueFromFqn)
    );

    // Normalize Note Attributes
    const noteClass = extractNoteAttr(searchAttributes.attrClassification);
    const noteNTK = extractNoteAttr(searchAttributes.attrNeedtoknow);
    const noteRelTo = extractNoteAttr(searchAttributes.attrRelto);

    // All of check (Classification & NeedToKnow)
    // The user must have every single one of these attributes.
    const allofAttributes = [...noteClass, ...noteNTK];
    for (const attr of allofAttributes) {
        if (!trimmedEntitlements.has(attr)) {
            return true; // Fail due to missing a required all of attribute
        }
    }

    // Any of check
    // If RelTo attributes exist, the user only needs to match ONE.
    if (noteRelTo.length > 0) {
        const hasAtLeastOneRelTo = noteRelTo.some(rel => trimmedEntitlements.has(rel));

        if (!hasAtLeastOneRelTo) {
            // console.log("User does not have any of the required RelTo attributes");
            return true; // Fail user has none of the specified RelTo values
        }
    }

    return false; // Success: All checks passed
};

// Checks if the user has the required RelTo entitlements. Returns true if the user is missing required RelTo values.
export const checkRelToEntitlements = (relToAttrs: string[] | undefined, activeEntitlements: Set<string>): boolean => {
    if (!relToAttrs || relToAttrs.length === 0) return false; // No RelTo attributes means no entitlement check needed

    // Check if the user has any of the RelTo attributes with array check for overlapping elements between relToAttrs and activeEntitlements
    const hasAtLeastOneRelTo = relToAttrs.some(rel => activeEntitlements.has(rel));

    if (!hasAtLeastOneRelTo) {
        return true; // Fail if user does not have any of the specified RelTo values
    }

    return false; // Success: User has at least one of the required RelTo values
};

// Utility to calculate all subordinate classifications for a selected classification.
export const getSubordinateClassifications = (selectedClass: string): string[] => {
    // Look up the priority of the selected class
    const selectedPriority = ClassificationPriority[selectedClass as keyof typeof ClassificationPriority];
    if (selectedPriority === undefined) return [];

    // Filter all classifications whose priority is less than or equal to the selected one.
    return Object.keys(ClassificationPriority).filter(
        (key) => ClassificationPriority[key as keyof typeof ClassificationPriority] <= selectedPriority
    );
};

// Checks form data against user entitlements to find unavailable attributes.
export const checkAndSetUnavailableAttributes = (
    data: IChangeEvent<any, RJSFSchema>,
    attrFields: string[] | undefined,
    entitlements: Set<string>,
    setUnavailAttrs: React.Dispatch<React.SetStateAction<string[]>>
) => {
    const { formData } = data;

    if (!formData || !attrFields) {
        setUnavailAttrs([]);
        return;
    }

    const pendingUnavailAttrs = Object.entries(formData).reduce((acc: string[], [key, value]) => {
        if (attrFields.includes(key)) {
            // Normalize value to an array if it's a single select/string
            let values = Array.isArray(value) ? value : [value as string];

            if (key === 'attrRelTo') {
                // Check if the user has any of these values in their entitlements
                const hasAtLeastOne = values.some(v => entitlements.has(v));

                // If they have none of the values mark the whole set as unavailable
                if (!hasAtLeastOne && values.length > 0) {
                    acc.push(...values);
                }
            }
            // All of logic for the rest of the attributes
            else {
                values.forEach((v: string) => {
                    if (v && !entitlements.has(v)) {
                        acc.push(v);
                    }
                });
            }
        }
        return acc;
    }, []);

    setUnavailAttrs(pendingUnavailAttrs);
};

// Sets the entitlements state based on the user object from useAuth.
export const updateEntitlementsFromUser = (
    user: { entitlements: string[] } | null | undefined,
    setEntitlements: React.Dispatch<React.SetStateAction<Set<string>>>
) => {
    if (user && user.entitlements) {
        setEntitlements(new Set(user.entitlements));
    }
};


export function attrFqn(attr: string, value: string) {
  return `https://${namespace}/attr/${attr}/value/${value}`.toLowerCase();
}

export function getAttributes(...attrs: Array<string | string[] | undefined>): string[] {
  const flattened = [];
  for (const attr of attrs) {
    if (Array.isArray(attr) && attr.length > 0) {
      flattened.push(...attr);
    } else if (typeof attr === 'string') {
      flattened.push(attr);
    }
  }
  return flattened;
}

export const reltoMap: {
  [attrValue: string]: {
    label: string;
    group?: string;
  };
} = {
  FVEY: { label: 'FVEY', group: 'priority' },
  NATO: { label: 'NATO', group: 'priority' },
  PINK: { label: 'PINK', group: 'priority' },
  PARTNERA: { label: 'PARTNER A', group: 'priority' },
  PARTNERB: { label: 'PARTNER B', group: 'priority' },
  LEADNATION: { label: 'LEAD NATION', group: 'priority' },
  AFG: { label: 'AFGHANISTAN' },
  XQZ: { label: 'AKROTIRI' },
  ALB: { label: 'ALBANIA' },
  ALA: { label: 'ALAND ISLANDS' },
  DZA: { label: 'ALGERIA' },
  ASM: { label: 'AMERICAN SAMOA' },
  AND: { label: 'ANDORRA' },
  AGO: { label: 'ANGOLA' },
  AIA: { label: 'ANGUILLA' },
  ATA: { label: 'ANTARCTICA' },
  ATG: { label: 'ANTIGUA AND BARBUDA' },
  ARG: { label: 'ARGENTINA' },
  ARM: { label: 'ARMENIA' },
  ABW: { label: 'ARUBA' },
  XAC: { label: 'ASHMORE AND CARTIER ISLANDS' },
  AUS: { label: 'AUSTRALIA', group: 'priority' },
  AUT: { label: 'AUSTRIA' },
  AZE: { label: 'AZERBAIJAN' },
  BHS: { label: 'BAHAMAS, THE' },
  BHR: { label: 'BAHRAIN' },
  XBK: { label: 'BAKER ISLAND' },
  BGD: { label: 'BANGLADESH' },
  BRB: { label: 'BARBADOS' },
  XBI: { label: 'BASSAS DA INDIA' },
  BLR: { label: 'BELARUS' },
  BEL: { label: 'BELGIUM' },
  BLZ: { label: 'BELIZE' },
  BEN: { label: 'BENIN' },
  BMU: { label: 'BERMUDA' },
  BTN: { label: 'BHUTAN' },
  BOL: { label: 'BOLIVIA' },
  BES: { label: 'BONAIRE, SINT EUSTATIUS AND SABA' },
  BIH: { label: 'BOSNIA AND HERZEGOVINA' },
  BWA: { label: 'BOTSWANA' },
  BVT: { label: 'BOUVET ISLAND' },
  BRA: { label: 'BRAZIL' },
  IOT: { label: 'BRITISH INDIAN OCEAN TERRITORY' },
  BRN: { label: 'BRUNEI' },
  BGR: { label: 'BULGARIA' },
  BFA: { label: 'BURKINA FASO' },
  MMR: { label: 'BURMA' },
  BDI: { label: 'BURUNDI' },
  CPV: { label: 'CABO VERDE' },
  KHM: { label: 'CAMBODIA' },
  CMR: { label: 'CAMEROON' },
  CAN: { label: 'CANADA' },
  CYM: { label: 'CAYMAN ISLANDS' },
  CAF: { label: 'CENTRAL AFRICAN REPUBLIC' },
  TCD: { label: 'CHAD' },
  CHL: { label: 'CHILE' },
  CHN: { label: 'CHINA' },
  CXR: { label: 'CHRISTMAS ISLAND' },
  CPT: { label: 'CLIPPERTON ISLAND' },
  CCK: { label: 'COCOS (KEELING) ISLANDS' },
  COL: { label: 'COLOMBIA' },
  COM: { label: 'COMOROS' },
  COG: { label: 'CONGO (BRAZZAVILLE)' },
  COD: { label: 'CONGO(KINSHASA)' },
  COK: { label: 'COOK ISLANDS' },
  XCS: { label: 'CORAL SEA ISLANDS' },
  CRI: { label: 'COSTA RICA' },
  CIV: { label: 'CÔTE D\'IVOIRE' },
  HRV: { label: 'CROATIA' },
  CUB: { label: 'CUBA' },
  CUW: { label: 'CURAÇAO' },
  CYP: { label: 'CYPRUS' },
  CZE: { label: 'CZECH REPUBLIC' },
  DNK: { label: 'DENMARK' },
  XXD: { label: 'DHEKELIA' },
  DGA: { label: 'DIEGO GARCIA' },
  DJI: { label: 'DJIBOUTI' },
  DMA: { label: 'DOMINICA' },
  DOM: { label: 'DOMINICAN REPUBLIC' },
  ECU: { label: 'ECUADOR' },
  EGY: { label: 'EGYPT' },
  SLV: { label: 'EL SALVADOR' },
  XAZ: { label: 'ENTITY 1' },
  XCR: { label: 'ENTITY 2' },
  XCY: { label: 'ENTITY 3' },
  XKM: { label: 'ENTITY 4' },
  XKN: { label: 'ENTITY 5' },
  AX3: { label: 'ENTITY 6' },
  GNQ: { label: 'EQUATORIAL GUINEA' },
  ERI: { label: 'ERITREA' },
  EST: { label: 'ESTONIA' },
  ETH: { label: 'ETHIOPIA' },
  XEU: { label: 'EUROPA ISLAND' },
  FLK: { label: 'FALKLAND ISLANDS (ISLAS MALVINAS)' },
  FRO: { label: 'FAROE ISLANDS' },
  FJI: { label: 'FIJI' },
  FIN: { label: 'FINLAND' },
  FRA: { label: 'FRANCE', group: 'priority' },
  GUF: { label: 'FRENCH GUIANA' },
  PYF: { label: 'FRENCH POLYNESIA' },
  ATF: { label: 'FRENCH SOUTHERN AND ANTARCTIC LANDS' },
  GAB: { label: 'GABON' },
  GMB: { label: 'GAMBIA, THE' },
  XGZ: { label: 'GAZA STRIP' },
  GEO: { label: 'GEORGIA' },
  DEU: { label: 'GERMANY' },
  GHA: { label: 'GHANA' },
  GIB: { label: 'GIBRALTAR' },
  XGL: { label: 'GLORIOSO ISLANDS' },
  GRC: { label: 'GREECE' },
  GRL: { label: 'GREENLAND' },
  GRD: { label: 'GRENADA' },
  GLP: { label: 'GUADELOUPE' },
  GUM: { label: 'GUAM' },
  AX2: { label: 'GUANTANAMO BAY NAVAL BASE' },
  GTM: { label: 'GUATEMALA' },
  GGY: { label: 'GUERNSEY' },
  GIN: { label: 'GUINEA' },
  GNB: { label: 'GUINEA-BISSAU' },
  GUY: { label: 'GUYANA' },
  HTI: { label: 'HAITI' },
  HMD: { label: 'HEARD ISLAND AND MCDONALD ISLANDS' },
  HND: { label: 'HONDURAS' },
  HKG: { label: 'HONG KONG' },
  XHO: { label: 'HOWLAND ISLAND' },
  HUN: { label: 'HUNGARY' },
  ISL: { label: 'ICELAND' },
  IND: { label: 'INDIA' },
  IDN: { label: 'INDONESIA' },
  IRN: { label: 'IRAN' },
  IRQ: { label: 'IRAQ' },
  IRL: { label: 'IRELAND' },
  IMN: { label: 'ISLE OF MAN' },
  ISR: { label: 'ISRAEL' },
  ITA: { label: 'ITALY' },
  JAM: { label: 'JAMAICA' },
  XJM: { label: 'JAN MAYEN' },
  JPN: { label: 'JAPAN' },
  XJV: { label: 'JARVIS ISLAND' },
  JEY: { label: 'JERSEY' },
  XJA: { label: 'JOHNSTON ATOLL' },
  JOR: { label: 'JORDAN' },
  XJN: { label: 'JUAN DE NOVA ISLAND' },
  KAZ: { label: 'KAZAKHSTAN' },
  KEN: { label: 'KENYA' },
  XKR: { label: 'KINGMAN REEF' },
  KIR: { label: 'KIRIBATI' },
  PRK: { label: 'KOREA, NORTH' },
  KOR: { label: 'KOREA, SOUTH' },
  XKS: { label: 'KOSOVO' },
  KWT: { label: 'KUWAIT' },
  KGZ: { label: 'KYRGYZSTAN' },
  LAO: { label: 'LAOS' },
  LVA: { label: 'LATVIA' },
  LBN: { label: 'LEBANON' },
  LSO: { label: 'LESOTHO' },
  LBR: { label: 'LIBERIA' },
  LBY: { label: 'LIBYA' },
  LIE: { label: 'LIECHTENSTEIN' },
  LTU: { label: 'LITHUANIA' },
  LUX: { label: 'LUXEMBOURG' },
  MAC: { label: 'MACAU' },
  MKD: { label: 'MACEDONIA' },
  MDG: { label: 'MADAGASCAR' },
  MWI: { label: 'MALAWI' },
  MYS: { label: 'MALAYSIA' },
  MDV: { label: 'MALDIVES' },
  MLI: { label: 'MALI' },
  MLT: { label: 'MALTA' },
  MHL: { label: 'MARSHALL ISLANDS' },
  MTQ: { label: 'MARTINIQUE' },
  MRT: { label: 'MAURITANIA' },
  MUS: { label: 'MAURITIUS' },
  MYT: { label: 'MAYOTTE' },
  MEX: { label: 'MEXICO' },
  FSM: { label: 'MICRONESIA, FEDERATED STATES OF' },
  XMW: { label: 'MIDWAY ISLANDS' },
  MDA: { label: 'MOLDOVA' },
  MCO: { label: 'MONACO' },
  MNG: { label: 'MONGOLIA' },
  MNE: { label: 'MONTENEGRO' },
  MSR: { label: 'MONTSERRAT' },
  MAR: { label: 'MOROCCO' },
  MOZ: { label: 'MOZAMBIQUE' },
  NAM: { label: 'NAMIBIA' },
  NRU: { label: 'NAURU' },
  XNV: { label: 'NAVASSA ISLAND' },
  NPL: { label: 'NEPAL' },
  NLD: { label: 'NETHERLANDS' },
  NCL: { label: 'NEW CALEDONIA' },
  NZL: { label: 'NEW ZEALAND' },
  NIC: { label: 'NICARAGUA' },
  NER: { label: 'NIGER' },
  NGA: { label: 'NIGERIA' },
  NIU: { label: 'NIUE' },
  NFK: { label: 'NORFOLK ISLAND' },
  MNP: { label: 'NORTHERN MARIANA ISLANDS' },
  NOR: { label: 'NORWAY' },
  OMN: { label: 'OMAN' },
  PAK: { label: 'PAKISTAN' },
  PLW: { label: 'PALAU' },
  XPL: { label: 'PALMYRA ATOLL' },
  PAN: { label: 'PANAMA' },
  PNG: { label: 'PAPUA NEW GUINEA' },
  XPR: { label: 'PARACEL ISLANDS' },
  PRY: { label: 'PARAGUAY' },
  PER: { label: 'PERU' },
  PHL: { label: 'PHILIPPINES' },
  PCN: { label: 'PITCAIRN ISLANDS' },
  PSE: { label: 'PALESTINE' },
  POL: { label: 'POLAND' },
  PRT: { label: 'PORTUGAL' },
  PRI: { label: 'PUERTO RICO' },
  QAT: { label: 'QATAR' },
  REU: { label: 'REUNION' },
  ROU: { label: 'ROMANIA' },
  RUS: { label: 'RUSSIA' },
  RWA: { label: 'RWANDA' },
  BLM: { label: 'SAINT BARTHELEMY' },
  SHN: { label: 'SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA' },
  KNA: { label: 'SAINT KITTS AND NEVIS' },
  LCA: { label: 'SAINT LUCIA' },
  MAF: { label: 'SAINT MARTIN' },
  SPM: { label: 'SAINT PIERRE AND MIQUELON' },
  VCT: { label: 'SAINT VINCENT AND THE GRENADINES' },
  WSM: { label: 'SAMOA' },
  SMR: { label: 'SAN MARINO' },
  STP: { label: 'SAO TOME AND PRINCIPE' },
  SAU: { label: 'SAUDI ARABIA' },
  SEN: { label: 'SENEGAL' },
  SRB: { label: 'SERBIA' },
  SYC: { label: 'SEYCHELLES' },
  SLE: { label: 'SIERRA LEONE' },
  SGP: { label: 'SINGAPORE' },
  SXM: { label: 'SINT MAARTEN' },
  SVK: { label: 'SLOVAKIA' },
  SVN: { label: 'SLOVENIA' },
  SLB: { label: 'SOLOMON ISLANDS' },
  SOM: { label: 'SOMALIA' },
  ZAF: { label: 'SOUTH AFRICA' },
  SGS: { label: 'SOUTH GEORGIA AND SOUTH SANDWICH ISLANDS' },
  SSD: { label: 'SOUTH SUDAN' },
  ESP: { label: 'SPAIN' },
  XSP: { label: 'SPRATLY ISLANDS' },
  LKA: { label: 'SRI LANKA' },
  SDN: { label: 'SUDAN' },
  SUR: { label: 'SURINAME' },
  SJM: { label: 'SVALBARD' },
  SWZ: { label: 'SWAZILAND' },
  SWE: { label: 'SWEDEN' },
  CHE: { label: 'SWITZERLAND' },
  SYR: { label: 'SYRIA' },
  TWN: { label: 'TAIWAN' },
  TJK: { label: 'TAJIKISTAN' },
  TZA: { label: 'TANZANIA' },
  THA: { label: 'THAILAND' },
  TLS: { label: 'TIMOR-LESTE' },
  TGO: { label: 'TOGO' },
  TKL: { label: 'TOKELAU' },
  TON: { label: 'TONGA' },
  TTO: { label: 'TRINIDAD AND TOBAGO' },
  XTR: { label: 'TROMELIN ISLAND' },
  TUN: { label: 'TUNISIA' },
  TUR: { label: 'TURKEY' },
  TKM: { label: 'TURKMENISTAN' },
  TCA: { label: 'TURKS AND CAICOS ISLANDS' },
  TUV: { label: 'TUVALU' },
  UGA: { label: 'UGANDA' },
  UKR: { label: 'UKRAINE' },
  ARE: { label: 'UNITED ARAB EMIRATES' },
  GBR: { label: 'UNITED KINGDOM', group: 'priority' },
  USA: { label: 'UNITED STATES', group: 'priority' },
  AX1: { label: 'UNKNOWN' },
  URY: { label: 'URUGUAY' },
  UZB: { label: 'UZBEKISTAN' },
  UMI: { label: 'US MINOR OUTLYING ISLANDS' },
  VUT: { label: 'VANUATU' },
  VAT: { label: 'VATICAN CITY' },
  VEN: { label: 'VENEZUELA' },
  VNM: { label: 'VIETNAM' },
  VGB: { label: 'VIRGIN ISLANDS, BRITISH' },
  VIR: { label: 'VIRGIN ISLANDS, U.S.' },
  XWK: { label: 'WAKE ISLAND' },
  WLF: { label: 'WALLIS AND FUTUNA' },
  XWB: { label: 'WEST BANK' },
  ESH: { label: 'WESTERN SAHARA' },
  YEM: { label: 'YEMEN' },
  ZMB: { label: 'ZAMBIA' },
  ZWE: { label: 'ZIMBABWE' },
};

export type AttributeValue = {
  label: string;
  value: string;
  group?: string;
};

export const { classification, needToKnow, relto } = policy[0].attributes.reduce(
  (
    acc: Record<string, AttributeValue[]>,
    attr: { name: string; values: Array<{ value: string }> },
  ) => {
    if (attr.name === 'classification') {
      acc.classification = attr.values.map(({ value }) => ({
        label: value.toUpperCase(),
        value: attrFqn('classification', value),
      }));
    } else if (attr.name === 'needtoknow') {
      acc.needToKnow = attr.values.map(({ value }) => ({
        label: value.toUpperCase(),
        value: attrFqn('needtoknow', value),
      }));
    } else if (attr.name === 'relto') {
      acc.relto = attr.values
        .map(({ value }) => {
          const mapped = reltoMap[value.toUpperCase()];
          if (!mapped) {
            console.warn(`Unknown relto value: ${value}`);
            return {
              label: value,
              value: attrFqn('relto', value),
            };
          }
          return {
            label: mapped.label,
            value: attrFqn('relto', value),
            group: mapped.group,
          };
        })
        .sort((a, b) => {
          if (a.group === 'priority' && b.group !== 'priority') return -1;
          if (b.group === 'priority' && a.group !== 'priority') return 1;
          return a.value.localeCompare(b.value);
        });
    }
    return acc;
  },
  {} as { classification: AttributeValue[]; needToKnow: AttributeValue[]; relto: AttributeValue[] },
);

export const attributes = { classification, needToKnow, relto };
