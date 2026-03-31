import java.nio.charset.StandardCharsets
import java.time.format.DateTimeFormatter
import java.time.OffsetDateTime
import java.util.Calendar
import java.sql.Timestamp

flowFile = session.get()
if(!flowFile) return

def conn = CTL.db.getConnection()
def cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
def dtf = DateTimeFormatter.ISO_OFFSET_DATE_TIME

try {
    sqlTableName = context.getProperty("db_tablename").evaluateAttributeExpressions().getValue()
    
    flowFile = session.write(flowFile, {inputStream, outputStream ->
        def uri = null // Usually populated after TDF conversion, but empty here as per original
        def geo = flowFile.getAttribute("tdf_geo")
        
        // Get Search and Metadata attributes
        def search = flowFile.getAttribute("tdf_search")
        def metadata = flowFile.getAttribute("tdf_metadata")

        def src = flowFile.getAttribute("tdf_src")
        if (src!=null){
            src = src.toLowerCase()
        } else {
            throw new Exception("tdf_src required");
        }
        
        def ts = flowFile.getAttribute("tdf_ts")
        if (ts!=null){
            ts = new Timestamp(1000 * OffsetDateTime.parse(ts, dtf).toEpochSecond())
        }

        // Updated SQL to include metadata
        def sql = "INSERT INTO ${sqlTableName}(ts, geo, src_type, search, metadata, tdf_blob, tdf_uri) VALUES (?,ST_AsText(ST_GeomFromGeoJSON(?)),?,to_json(?::json),to_json(?::json), ?,?)"

        def myStmt = conn.prepareStatement(sql)
        myStmt.setTimestamp(1, ts)
        myStmt.setString(2, geo)
        myStmt.setString(3, src)
        myStmt.setString(4, search)   // Maps to search column
        myStmt.setString(5, metadata) // Maps to metadata column
        myStmt.setBinaryStream(6, inputStream)
        myStmt.setString(7, uri)
        
        myStmt.executeUpdate()
    } as StreamCallback)
    
    session.transfer(flowFile, REL_SUCCESS)
} catch(Exception ex) {
    log.error('Error processing poi data: {}', ex)
    session.transfer(flowFile, REL_FAILURE)
} finally{
    conn.close()
}