import { LayerGroup, LayersControl } from 'react-leaflet';
import { TdfObjectResponse } from '@/hooks/useRpcClient';
import { ClusterLayer } from '@/components/Map/ClusterLayer';
import { MarkerLayer } from '@/components/Map/MarkerLayer';
import { useSourceType } from '@/pages/SourceTypes/SourceTypeContext';

type Props = {
  tdfObjects: TdfObjectResponse[];
};


export function TdfObjectsMapLayer({ tdfObjects = [] }: Props) {
  const { id, mapFields } = useSourceType();

  const groupTdfObjectsByDecryptedDataProperty = (arr:TdfObjectResponse[], property:string) => {

    return arr.reduce((memo:Record<string, TdfObjectResponse[]>, x:TdfObjectResponse) => {
      const groupByValue = x.decryptedData[property] || 'ungrouped';

      if (!memo[groupByValue]) {
        memo[groupByValue] = [];
      }
      memo[groupByValue].push(x);

      return memo;
    }, {});
  };

  const groupLayersBy = mapFields?.colorConfig[0].field || '';
  const groupedTDFObjects = groupTdfObjectsByDecryptedDataProperty(tdfObjects, groupLayersBy);
  const layersToRender = Object.keys(groupedTDFObjects);

  // TODO: conditonally enable/disable clustering
  const clusterEnabled = false;
  if (clusterEnabled){
    return (
      <LayersControl.Overlay checked name={id} key={id}>
        <LayerGroup>
          {layersToRender.map( key => (
            <ClusterLayer tdfObjects={groupedTDFObjects[key]} key={`cluster-layer-${key}`} layerName={key}/>
          ))}
        </LayerGroup>
      </LayersControl.Overlay>
    );
  } else {
    return (
      <LayersControl.Overlay checked name={id} key={id}>
        <LayerGroup>
          {layersToRender.map( key => (
            <MarkerLayer tdfObjects={groupedTDFObjects[key]} key={`layer-${key}`} layerName={key} isCluster/>
          ))}
        </LayerGroup>
      </LayersControl.Overlay>
    );
  }
}