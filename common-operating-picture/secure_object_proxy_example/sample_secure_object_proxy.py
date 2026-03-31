import boto3

import sample_util as sample_util

print(f"Requesting JWT for user 'top-secret-gbr-bbb'")

s3_client = sample_util.get_boto3_client(username='top-secret-gbr-bbb')
print(f"Created S3 Client: {s3_client}")

# List objects
bucket_name = 'cop-demo'
print(f"Listed objects in bucket '{bucket_name}' ")
objects = s3_client.list_objects_v2(Bucket=bucket_name)
for obj in objects.get('Contents', []):
    print(f" - {obj['Key']}")

