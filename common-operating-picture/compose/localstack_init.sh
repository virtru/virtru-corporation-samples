#!/bin/bash
echo "Initializing LocalStack S3 bucket 'cop-demo' with versioning enabled..."
awslocal s3 mb s3://cop-demo --endpoint-url=http://localhost:4566
aws s3api put-bucket-versioning --bucket cop-demo --versioning-configuration Status=Enabled