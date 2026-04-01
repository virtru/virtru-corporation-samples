import groovy.json.JsonBuilder
import groovy.json.JsonSlurper
import org.apache.commons.io.IOUtils
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.math.BigDecimal
import java.time.Instant

flowFile = session.get()
if(!flowFile) return

// Coordinate parsing settings
latPrecisionPlaces = 7
lngPrecisionPlaces = 8

def coordElementToFloat(coordStr, isLongitude, precisionPlaces) {
    if (coordStr == null) return 0.0
    def positiveChar = isLongitude ? "E" : "N"
    def isPositive = coordStr[coordStr.length()-1] == positiveChar
    def valueStr = coordStr.substring(0, coordStr.length()-1)
    if (valueStr.length() <= precisionPlaces) return 0.0
    def valueDecimal = valueStr.length() - precisionPlaces
    def valueWithDecimal = valueStr.substring(0, valueDecimal) + "." + valueStr.substring(valueDecimal)
    def decimalValue = new BigDecimal(valueWithDecimal)
    if (!isPositive) decimalValue = decimalValue.negate()
    return decimalValue
}

def parseLngLat(coordStr){
    if (coordStr == null || (!coordStr.contains('N') && !coordStr.contains('S'))) return null
    def splitIndex = coordStr.indexOf('N') > 0 ? coordStr.indexOf('N') : coordStr.indexOf('S')
    def latStr = coordStr.substring(0, splitIndex+1)
    def lngStr = coordStr.substring(splitIndex+1)
    return [coordElementToFloat(lngStr, true, lngPrecisionPlaces), coordElementToFloat(latStr, false, latPrecisionPlaces)]
}

try {
    def recordList = []
    session.read(flowFile, {inputStream ->
        try {
            recordList = new JsonSlurper().parse(inputStream)
        } catch (Exception e) {
            log.warn("Could not parse JSON content: " + e.message)
            recordList = []
        }
    } as InputStreamCallback)

    for (record in recordList){
        def originalData = record['original']
        def enrichedData = record['enrichment']
        def objectType = originalData['Type'] ?: "Unknown"
        def tdfAttributes = enrichedData['tdf_attributes']
        def details = originalData['Details'] ?: [:]
        def searchData = originalData['Search'] ?: [:]
        def metadataData = originalData['Metadata']

        newFlowFile = session.create(flowFile)
        newFlowFile = session.putAttribute(newFlowFile, 'tdf_attribute', tdfAttributes)
        newFlowFile = session.putAttribute(newFlowFile, 'tdf_src', objectType)
        
        // TDF FORMAT: Read from data, default to "nano" if not specified
        def tdfFormat = originalData['tdfFormat'] ?: "nano"
        newFlowFile = session.putAttribute(newFlowFile, 'tdf_format', tdfFormat)
        
        // TIMESTAMP: Fallback logic
        def ts = details['ProducerDateTimeLastChg']
        if (!ts) ts = details['datetimeCreated']
        if (!ts) ts = Instant.now().toString()
        newFlowFile = session.putAttribute(newFlowFile, 'tdf_ts', ts)
        
        // SEARCH: Convert to JSON string
        if (searchData) {
            newFlowFile = session.putAttribute(newFlowFile, 'tdf_search', new JsonBuilder(searchData).toString())
        }

        // METADATA: Explicitly default to "{}" if empty/null
        def metaJson = metadataData ? new JsonBuilder(metadataData).toString() : "{}"
        newFlowFile = session.putAttribute(newFlowFile, 'tdf_metadata', metaJson)

        // GEO: Parse Coordinates
        def coordStr = details['Coord']
        if (coordStr && coordStr instanceof String) {
            def lngLat = parseLngLat(coordStr)
            if (lngLat) {
                def pointMap = ['type' : 'Point', 'coordinates':[lngLat[0], lngLat[1]]]
                newFlowFile = session.putAttribute(newFlowFile, 'tdf_geo', new JsonBuilder(pointMap).toPrettyString())
            }
        }
        
        // PAYLOAD
        payloadObj = details
        newFlowFile = session.write(newFlowFile, {inputStream, outputStream ->
            def oos = new OutputStreamWriter(outputStream)
            new JsonBuilder(payloadObj).writeTo(oos)
            oos.close()
        } as StreamCallback)

        session.transfer(newFlowFile, REL_SUCCESS)
    }
    session.remove(flowFile)
} catch(Exception ex) {
    log.error('Error processing enriched mission data: {}', ex)
    session.transfer(flowFile, REL_FAILURE)
}