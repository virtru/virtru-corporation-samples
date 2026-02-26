 # Secure Object Proxy

 Deployment includes the Secure Object Proxy and an S3 compliant backend (localstack).

 The docker compose provisions a bucket `cop-demo`

 To validate and the bucket is created and/or browse the bucket:

 http://localhost:4566/cop-demo


Add s4/localstack hosts to /etc/hosts:

 ```
 echo "127.0.0.1  local-s4.virtru.com" | sudo tee -a /etc/hosts
 echo "127.0.0.1  s4-test.local-s4.virtru.com" | sudo tee -a /etc/hosts
```

## Using Minio MC CLI
Use Minio CLI to interact with the Secure Object Proxy

Install Minio mc
```shell
brew install minio/stable/mc
```

Add an alias for the Secure Object Proxy
```shell
mc alias set s4 http://s4-test.localhost:7070 "user" "replaceme" --api "S3v4" --path "on"
```

Get Bearer Token
AUTH_TOKEN=$(./get_jwt.sh --quiet)
```shell
AUTH_TOKEN=$(curl -d 'client_id=opentdf' -d 'client_secret=secret' -d 'grant_type=client_credentials' 'https://local-dsp.virtru.com:8443/auth/realms/opentdf/protocol/openid-connect/token' | jq -r .access_token)
```

List Buckets:
```shell
mc -H "Authorization: Bearer ${AUTH_TOKEN}" ls s4
```

Sample Copy Object, explicitly specifying data attributes. Note: Write input and `^D` twice to end input.
```shell
echo "sample" > sample.txt

mc -H "Authorization: Bearer ${AUTH_TOKEN}" cp \
  --attr "Tdf-Data-Attribute-0=https://demo.com/attr/classification/value/topsecret;Tdf-Data-Attribute-1=https://demo.com/attr/needtoknow/value/bbb" \
  sample.txt s4/cop-demo
```

Sample Get Object.
```shell
mc -H "Authorization: Bearer ${AUTH_TOKEN}" cat s4/cop-demo/sample.txt
```


# Example React Code

## Authentication
Authenticate to Secure Object Proxy by using STS to exchange the user's JWT for S3 credentials

```
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { S3Provider } from '../types/s3';

export interface STSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

class STSService {
  async assumeRoleWithWebIdentity(
    provider: S3Provider,
    webIdentityToken: string
  ): Promise<STSCredentials> {
    if (!provider.useSts || !provider.stsEndpoint || !provider.roleArn) {
      throw new Error('Provider is not configured for STS authentication');
    }

    const stsClient = new STSClient({
      region: provider.stsRegion || provider.region,
      endpoint: provider.stsEndpoint,
    });

    const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: provider.roleArn,
      WebIdentityToken: webIdentityToken,
      RoleSessionName: `s3-browser-session-${Date.now()}`,
      DurationSeconds: 3600, // 1 hour
    });

    try {
      const response = await stsClient.send(command);
      
      if (!response.Credentials) {
        throw new Error('No credentials returned from STS');
      }

      return {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
      };
    } catch (error) {
      console.error('Error assuming role with web identity:', error);
      throw new Error(`STS authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  decodeOidcAccessToken(token: string) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const decodedHeader = this.decodeBase64Url(parts[0]);
    const decodedPayload = this.decodeBase64Url(parts[1]);

    return {
      header: JSON.parse(decodedHeader),
      payload: JSON.parse(decodedPayload),
    };
  }

  private decodeBase64Url(str: string): string {
    let output = str.replace(/-/g, '+').replace(/_/g, '/');
    while (output.length % 4) {
      output += '=';
    }
    return atob(output);
  }
}

export const stsService = new STSService();
```

## Example S3 Service

```
mport { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Provider, S3Object } from '../types/s3';
import { STSCredentials } from './stsService';

class S3Service {
  private client: S3Client | null = null;
  private currentProvider: S3Provider | null = null;

  setProvider(provider: S3Provider, credentials?: { accessKeyId: string; secretAccessKey: string } | STSCredentials) {
    this.currentProvider = provider;
    
    const clientConfig: any = {
      region: provider.region,
      forcePathStyle: provider.forcePathStyle,
    };

    if (provider.endpointUrl) {
      clientConfig.endpoint = provider.endpointUrl;
    }

    if (credentials) {
      clientConfig.credentials = credentials;
    }

    this.client = new S3Client(clientConfig);
  }

  async listObjects(prefix: string = ''): Promise<S3Object[]> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.currentProvider.bucket,
        Prefix: prefix,
        Delimiter: '/',
      });

      const response = await this.client.send(command);
      const objects: S3Object[] = [];

      // Add folders (common prefixes)
      if (response.CommonPrefixes) {
        for (const commonPrefix of response.CommonPrefixes) {
          if (commonPrefix.Prefix) {
            const folderName = commonPrefix.Prefix.replace(prefix, '').replace('/', '');
            if (folderName) {
              objects.push({
                key: commonPrefix.Prefix,
                isFolder: true,
              });
            }
          }
        }
      }

      // Add files
      if (response.Contents) {
        for (const content of response.Contents) {
          if (content.Key && content.Key !== prefix) {
            const fileName = content.Key.replace(prefix, '');
            if (fileName && !fileName.endsWith('/')) {
              objects.push({
                key: content.Key,
                lastModified: content.LastModified,
                size: content.Size,
                storageClass: content.StorageClass,
                isFolder: false,
              });
            }
          }
        }
      }

      return objects.sort((a, b) => {
        // Folders first, then files
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.key.localeCompare(b.key);
      });
    } catch (error) {
      console.error('Error listing S3 objects:', error);
      throw error;
    }
  }

  async getObjectUrl(key: string): Promise<string> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    // For now, return a simple URL construction
    // In a production environment, you might want to generate presigned URLs
    const baseUrl = this.currentProvider.endpointUrl || `https://s3.${this.currentProvider.region}.amazonaws.com`;
    return `${baseUrl}/${this.currentProvider.bucket}/${key}`;
  }

  async uploadFile(
    file: File, 
    objectKey: string, 
    attributeFqns?: string[],
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    try {
      if (onProgress) {
        onProgress(20);
      }

      // Convert File to ArrayBuffer for browser compatibility
      const arrayBuffer = await file.arrayBuffer();
      
      if (onProgress) {
        onProgress(40);
      }

      // Prepare user metadata for attribute FQNs
      const metadata: Record<string, string> = {};
      if (attributeFqns && attributeFqns.length > 0) {
        attributeFqns.forEach((fqn, index) => {
          metadata[`Tdf-Data-Attribute-${index}`] = fqn;
        });
      }
      
      const command = new PutObjectCommand({
        Bucket: this.currentProvider.bucket,
        Key: objectKey,
        Body: new Uint8Array(arrayBuffer),
        ContentType: file.type || 'application/octet-stream',
        ContentLength: file.size,
        Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });

      if (onProgress) {
        onProgress(60);
      }

      await this.client.send(command);

      if (onProgress) {
        onProgress(100);
      }

      console.log(`File uploaded successfully to ${objectKey}`);
    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async searchObjectsByPrefix(prefix: string): Promise<S3Object[]> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.currentProvider.bucket,
        Prefix: prefix,
        // No delimiter - we want to see all objects with this prefix
      });

      const response = await this.client.send(command);
      const objects: S3Object[] = [];

      // Add all objects that match the prefix
      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key && object.Key !== prefix) { // Exclude the prefix itself if it's a "folder"
            objects.push({
              key: object.Key,
              isFolder: false,
              size: object.Size || 0,
              lastModified: object.LastModified,
              storageClass: object.StorageClass,
            });
          }
        }
      }

      return objects.sort((a, b) => a.key.localeCompare(b.key));
    } catch (error) {
      console.error('Error searching objects by prefix:', error);
      throw new Error(`Failed to search objects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async downloadObject(key: string): Promise<Uint8Array> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    if (!key || key.trim() === '') {
      throw new Error('Object key cannot be empty');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.currentProvider.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      
      if (!response.Body) {
        throw new Error('No data received from S3');
      }

      // Handle different stream types
      if (response.Body instanceof Uint8Array) {
        return response.Body;
      }

      // For browser compatibility, convert stream to Uint8Array
      const chunks: Uint8Array[] = [];
      const reader = (response.Body as any).getReader ? (response.Body as any).getReader() : null;
      
      if (reader) {
        // Browser ReadableStream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } else {
        // Node.js Readable stream - convert to Uint8Array
        const stream = response.Body as any;
        const arrayBuffer = await stream.transformToByteArray();
        return new Uint8Array(arrayBuffer);
      }

      // Combine all chunks into a single Uint8Array
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    } catch (error) {
      console.error('Error downloading object:', error);
      throw new Error(`Failed to download object: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getObjectContent(key: string): Promise<{ content: Uint8Array; contentType: string; size: number }> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    if (!key || key.trim() === '') {
      throw new Error('Object key cannot be empty');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.currentProvider.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      
      if (!response.Body) {
        throw new Error('No data received from S3');
      }

      let content: Uint8Array;

      // Handle different stream types
      if (response.Body instanceof Uint8Array) {
        content = response.Body;
      } else {
        // For browser compatibility, convert stream to Uint8Array
        const chunks: Uint8Array[] = [];
        const reader = (response.Body as any).getReader ? (response.Body as any).getReader() : null;
        
        if (reader) {
          // Browser ReadableStream
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }

          // Combine all chunks into a single Uint8Array
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          content = new Uint8Array(totalLength);
          let offset = 0;
          
          for (const chunk of chunks) {
            content.set(chunk, offset);
            offset += chunk.length;
          }
        } else {
          // Node.js Readable stream - convert to Uint8Array
          const stream = response.Body as any;
          const arrayBuffer = await stream.transformToByteArray();
          content = new Uint8Array(arrayBuffer);
        }
      }

      return {
        content,
        contentType: response.ContentType || 'application/octet-stream',
        size: response.ContentLength || content.length,
      };
    } catch (error) {
      console.error('Error getting object content:', error);
      throw new Error(`Failed to get object content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async headObject(key: string): Promise<any> {
    if (!this.client || !this.currentProvider) {
      throw new Error('S3 client not configured');
    }

    if (!key || key.trim() === '') {
      throw new Error('Object key cannot be empty');
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.currentProvider.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      
      // Return relevant metadata
      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
        storageClass: response.StorageClass,
        metadata: response.Metadata || {},
        cacheControl: response.CacheControl,
        contentDisposition: response.ContentDisposition,
        contentEncoding: response.ContentEncoding,
        contentLanguage: response.ContentLanguage,
        expires: response.Expires,
        serverSideEncryption: response.ServerSideEncryption,
        versionId: response.VersionId,
        websiteRedirectLocation: response.WebsiteRedirectLocation,
        acceptRanges: response.AcceptRanges,
      };
    } catch (error) {
      console.error('Error getting object head:', error);
      throw new Error(`Failed to get object head: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getCurrentProvider(): S3Provider | null {
    return this.currentProvider;
  }
}

export const s3Service = new S3Service();

```