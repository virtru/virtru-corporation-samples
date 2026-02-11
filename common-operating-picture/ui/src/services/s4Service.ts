import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// S4 Configuration
const S4_ENDPOINT = 'http://localhost:7070';
const S4_REGION = 'us-east-1';
const ROLE_ARN = 'arn:aws:iam::xxxx:xxx/xxx';

export interface STSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

// Full Military Manifest Types
export interface DocumentControl {
  manifestId: string;
  recordId: string;
  version: string;
  classification: string;
  caveats: string[];
  declassifyOn: string;
  createdAt: string;
  createdBy: string;
  originatingAgency: string;
}

export interface Platform {
  designation: string;
  name: string;
  type: string;
  service: string;
}

export interface VehicleInfo {
  registration: string;
  tailNumber: string;
  operator: string;
  platform: Platform;
  homeStation: string;
  icaoHex: string;
  mode5Interrogator: string;
}

export interface MissionTimeline {
  scheduled: string;
  takeoff: string;
  onStation: string;
  offStation: string;
  expectedRecovery: string;
}

export interface Airspace {
  operatingArea: string;
  altitudeBlock: string;
  restrictedAreas: string[];
}

export interface Mission {
  missionId: string;
  operationName: string;
  missionType: string;
  priority: string;
  commandAuthority: string;
  taskingOrder: string;
  missionStatus: string;
  timeline: MissionTimeline;
  airspace: Airspace;
}

export interface Target {
  targetId: string;
  targetName: string;
  targetType: string;
  priority: number;
}

export interface Intelligence {
  collectionDiscipline: string[];
  targetDeck: Target[];
  collectionRequirements: string[];
  reportingInstructions: string;
}

export interface Sensors {
  primarySensor: string;
  activeSensors: string[];
  emissionControl: string;
  datalinks: string[];
}

export interface FrequencyPlan {
  primary: string;
  secondary: string;
  guard: string;
}

export interface Coordination {
  supportingUnits: string[];
  coalitionPartners: string[];
  frequencyPlan: FrequencyPlan;
  checkInPoint: string;
}

export interface TrackQuality {
  source: string;
  reliability: number;
  positionAccuracy_m: number;
  velocityAccuracy_mps: number;
  lastUpdate: string;
  updateRate_sec: number;
}

export interface Processing {
  ingestPipeline: string;
  processingNode: string;
  processingTime_ms: number;
  correlationId: string;
  validated: boolean;
  fusedSources: number;
}

export interface MilitaryManifest {
  documentControl: DocumentControl;
  vehicle: VehicleInfo;
  mission: Mission;
  intelligence: Intelligence;
  sensors: Sensors;
  coordination: Coordination;
  trackQuality: TrackQuality;
  processing: Processing;
}

/**
 * Exchange JWT for temporary S3 credentials via S4 STS
 */
export async function getS4Credentials(accessToken: string): Promise<STSCredentials> {
  const stsClient = new STSClient({
    region: S4_REGION,
    endpoint: S4_ENDPOINT,
  });

  const command = new AssumeRoleWithWebIdentityCommand({
    RoleArn: ROLE_ARN,
    WebIdentityToken: accessToken,
    RoleSessionName: `cop-ui-session-${Date.now()}`,
    DurationSeconds: 3600,
  });

  const response = await stsClient.send(command);

  if (!response.Credentials) {
    throw new Error('No credentials returned from STS');
  }

  return {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
  };
}

/**
 * Parse S3 URI into bucket and key
 */
export function parseS3Uri(s3Uri: string): { bucket: string; key: string } | null {
  if (!s3Uri || !s3Uri.startsWith('s3://')) {
    return null;
  }
  
  const path = s3Uri.slice(5);
  const slashIndex = path.indexOf('/');
  
  if (slashIndex === -1) {
    return null;
  }
  
  const bucket = path.slice(0, slashIndex);
  const key = path.slice(slashIndex + 1);
  
  return { bucket, key };
}

/**
 * Fetch full military manifest from S4
 */
export async function fetchManifestFromS4(
  accessToken: string,
  manifestUri: string
): Promise<MilitaryManifest> {
  const parsed = parseS3Uri(manifestUri);
  if (!parsed) {
    throw new Error(`Invalid S3 URI: ${manifestUri}`);
  }

  const credentials = await getS4Credentials(accessToken);

  const s3Client = new S3Client({
    region: S4_REGION,
    endpoint: S4_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });

  try {
    const command = new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No data received from S4');
    }

    let bodyText: string;
    
    const reader = (response.Body as any).getReader?.();
    if (reader) {
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      bodyText = new TextDecoder().decode(combined);
    } else {
      const arrayBuffer = await (response.Body as any).transformToByteArray();
      bodyText = new TextDecoder().decode(new Uint8Array(arrayBuffer));
    }

    const manifest: MilitaryManifest = JSON.parse(bodyText);
    return manifest;
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      throw new Error('ENTITLEMENT_DENIED');
    }
    throw err;
  }
}