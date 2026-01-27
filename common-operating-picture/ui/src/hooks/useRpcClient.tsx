import { useCallback, useMemo } from 'react';
import { TdfObject, QueryTdfObjectsRequest, UpdateTdfObjectRequest, UpdateTdfObjectResponse } from '@/proto/tdf_object/v1/tdf_object_pb';
import { QueryTdfNotesRequest, TdfNote } from '@/proto/tdf_object/v1/tdf_note_pb';
import { PartialMessage } from '@bufbuild/protobuf';
import { crpcClient, drpcClient } from '@/api/connectRpcClient';
import { useTDF } from './useTdf';
import { useAuth } from './useAuth';
import DecryptWorker from '@/workers/decrypt.worker.ts?worker';
import { config } from '@/config';

export type TdfObjectResponse = {
  tdfObject: TdfObject;
  decryptedData: any;
}
export type TdfNotesResponse = {
  tdfNote: TdfNote;
  decryptedData: any;
}

// Web Worker Pool logic remains outside the hook to persist across renders
const WORKER_POOL_SIZE = 4;
const workerPool: Worker[] = [];
let nextWorkerIndex = 0;
let workersInitialized = false;

function getWorker(): Worker {
  if (workerPool.length < WORKER_POOL_SIZE) {
    const newWorker = new DecryptWorker();
    workerPool.push(newWorker);
    return newWorker;
  }
  const worker = workerPool[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % WORKER_POOL_SIZE;
  return worker;
}

async function initializeWorkers(user: ReturnType<typeof useAuth>['user']) {
  if (workersInitialized || !user?.refreshToken || !user?.accessToken) return;

  const initData = {
    config,
    user: { refreshToken: user.refreshToken, accessToken: user.accessToken },
  };

  const workerPromises = Array.from({ length: WORKER_POOL_SIZE }).map((_) => {
    const worker = getWorker();
    return new Promise<void>((resolve) => {
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'init-complete') {
          worker.removeEventListener('message', handleMessage);
          resolve();
        }
      };
      worker.addEventListener('message', handleMessage);
      worker.postMessage(initData);
    });
  });

  await Promise.all(workerPromises);
  workersInitialized = true;
  console.log(`Initialized ${WORKER_POOL_SIZE} decryption workers.`);
}

const tdfObjectCache = new Map<string, any>();

export function useRpcClient() {
  const { decrypt } = useTDF();
  const { user } = useAuth();

  // Initialize workers once user is available
  if (!workersInitialized && user) {
    initializeWorkers(user);
  }

  const authHeader = useMemo(() => ({
    headers: { 'Authorization': user?.accessToken || '' }
  }), [user?.accessToken]);

  const clearTdfObjectCache = useCallback(() => {
    tdfObjectCache.clear();
    console.log("TDF Object Cache cleared.");
  }, []);

  const transformTdfObject = useCallback(async (tdfObject: TdfObject): Promise<TdfObjectResponse> => {
    const objectId = tdfObject.id;

    // Extract Dynamic Data (Plaintext Search Field)
    // This contains live telemetry (Speed, Alt, Heading)
    let dynamicData = {};
    try {
      if (tdfObject.metadata && tdfObject.metadata !== "null") {
        dynamicData = JSON.parse(tdfObject.metadata);
      }
    } catch (e) {
      console.warn("Failed to parse dynamic metadata", e);
    }

    // Handle Static/Encrypted Data
    // Check Cache first for identity data (Name, Callsign)
    if (tdfObjectCache.has(objectId)) {
      return {
        tdfObject,
        decryptedData: { ...tdfObjectCache.get(objectId), ...dynamicData },
      };
    }

    // Fallback if workers aren't ready
    if (!workersInitialized || !tdfObject.tdfBlob || tdfObject.tdfBlob.length === 0) {
      return { tdfObject, decryptedData: dynamicData };
    }

    // Decrypt via Worker Pool
    const worker = getWorker();

    return new Promise((resolve) => {
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type !== 'decryption-result') return;
        worker.removeEventListener('message', handleMessage);

        const { decryptedPayload, error } = event.data;
        let staticData = {};

        if (decryptedPayload) {
          try {
            staticData = JSON.parse(decryptedPayload);
            // Cache identity data only (not the changing dynamic telemetry)
            if (tdfObject.srcType === 'vehicles') {
              tdfObjectCache.set(objectId, staticData);
            }
          } catch (e) {
            console.error("JSON parse failed on worker result:", e);
          }
        }

        if (error) console.error(`Decryption failed for ${objectId}:`, error);

        // Final Merge: Static (from Worker) + Dynamic (from Search Field)
        resolve({
          tdfObject,
          decryptedData: { ...staticData, ...dynamicData },
        });
      };

      worker.addEventListener('message', handleMessage);

      // Transfer ownership of the buffer to the worker for performance
      const tdfBlobBuffer = tdfObject.tdfBlob!.buffer.slice(0);
      worker.postMessage({ tdfBlobBuffer }, [tdfBlobBuffer]);
    });
  }, []);

  const transformNoteObject = useCallback(async (tdfNote: TdfNote): Promise<TdfNotesResponse | null> => {
    try {
      const decryptedData = await decrypt(tdfNote.tdfBlob.buffer);
      try {
        const parsedData = JSON.parse(decryptedData);
        return { tdfNote, decryptedData: parsedData };
      } catch (err) {
        console.error('Error parsing decrypted data:', err);
        return null;
      }
    } catch (err) {
      console.error('Error decrypting data:', err);
      return null;
    }
  }, [decrypt]);

  const queryTdfObjects = useCallback(async (request: PartialMessage<QueryTdfObjectsRequest>): Promise<TdfObjectResponse[]> => {
    const response = await crpcClient.queryTdfObjects(request, authHeader);
    const tdfObjectResponses = await Promise.all(response.tdfObjects.map(transformTdfObject));
    return tdfObjectResponses.filter((res): res is TdfObjectResponse => res !== null);
  }, [authHeader, transformTdfObject]);

  const queryTdfObjectsLight = useCallback(async (request: PartialMessage<QueryTdfObjectsRequest>): Promise<TdfObject[]> => {
    const response = await crpcClient.queryTdfObjects(request, authHeader);
    return response.tdfObjects;
  }, [authHeader]);

  const updateTdfObject = useCallback(async (request: PartialMessage<UpdateTdfObjectRequest>): Promise<UpdateTdfObjectResponse> => {
    return await crpcClient.updateTdfObject(request, authHeader);
  }, [authHeader]);

  const queryNotes = useCallback(async (request: PartialMessage<QueryTdfNotesRequest>): Promise<TdfNotesResponse[]> => {
    const response = await drpcClient.queryTdfNotes(request, authHeader);
    const noteResponses = await Promise.all(response.tdfNotes.map(transformNoteObject));
    return noteResponses.filter((res): res is TdfNotesResponse => res !== null);
  }, [authHeader, transformNoteObject]);

  // Memoize the return object so the object reference itself is stable
  return useMemo(() => ({
    queryNotes,
    createNoteObject: (req: any) => drpcClient.createTdfNote(req, authHeader),
    updateTdfObject,
    queryTdfObjects,
    queryTdfObjectsLight,
    transformTdfObject,
    createTdfObject: (req: any) => crpcClient.createTdfObject(req, authHeader),
    clearTdfObjectCache,
    getSrcType: (req: any) => crpcClient.getSrcType(req, authHeader),
    listSrcTypes: (req: any) => crpcClient.listSrcTypes(req, authHeader),
    streamTdfObjects: (req: any) => crpcClient.streamTdfObjects(req, authHeader),
  }), [
    queryNotes, 
    updateTdfObject, 
    queryTdfObjects, 
    queryTdfObjectsLight, 
    transformTdfObject, 
    clearTdfObjectCache, 
    authHeader
  ]);
}