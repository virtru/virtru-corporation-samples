import boto3
import requests, jwt
from typing import Optional
import base64
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)




def get_jwt(username, ssl_verify = False) -> Optional[str]:
    token_url = 'https://local-dsp.virtru.com:8443/auth/realms/opentdf/protocol/openid-connect/token'
    password = 'testuser123'
    client_id = 'secure-object-proxy-test'
    client_secret = 'secret'
    if token_url is None:
        return None
    auth = f"{client_id}:{client_secret}"
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + base64.b64encode(auth.encode()).decode()
    }

    payload = {
        'grant_type': 'password',
        'username': username,
        'password': password,
    }
    # print(f"Requesting token from {token_url} for user {username} using client ID {client_id}")
    try:
        response = requests.post(token_url, headers=headers, data=payload, verify=ssl_verify)
        response.raise_for_status()
        return response.json()["access_token"]
    except requests.exceptions.RequestException as e:
        print(f"Error during token request: {e}")
        return None    


def get_boto3_client(username, sts_endpoint_url='http://localhost:7070', 
                     s3_endpoint_url='http://s4-test.localhost:7070', region='us-east-1', 
                     ssl_verify=False):
    
    # Create an S3 client
    sts_client = boto3.client('sts',endpoint_url=sts_endpoint_url, verify=ssl_verify)
    response = sts_client.assume_role_with_web_identity(
            RoleArn='arn:aws:iam::xxxx:xxx/xxx',
            RoleSessionName='WebIdentitySession',
            WebIdentityToken=get_jwt(username),
            DurationSeconds=3600 
        )
    credentials = response['Credentials']
    
    s3_client = boto3.client(service_name='s3',
                                endpoint_url=s3_endpoint_url,
                                aws_access_key_id=credentials['AccessKeyId'],
                                aws_secret_access_key=credentials['SecretAccessKey'],
                                region_name=region, verify=ssl_verify)
    return s3_client