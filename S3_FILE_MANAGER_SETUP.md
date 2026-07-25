# Findoly CRM Amazon S3 File Manager setup

The CRM File Manager uses Amazon S3 as its storage source. AWS credentials are read only by the Node.js backend and are never sent to browser JavaScript.

## Install dependencies

Run this once after extracting or deploying the updated project:

```bash
npm install
```

This installs the CRM dependencies from the included lock file. The S3 File Manager uses Node.js built-in signing code, so it does not add a separate S3 SDK dependency.

## Required environment variables

```env
AWS_REGION=ap-south-1
AWS_S3_BUCKET=findoly-storage
```

Add restricted IAM credentials to the server environment:

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# Required only for temporary AWS credentials
AWS_SESSION_TOKEN=
```

Do not commit these values to the project. The current lightweight S3 integration reads environment credentials directly; it does not fetch EC2/ECS role credentials automatically.

Optional settings:

```env
AWS_S3_PUBLIC_PREFIX=public/
AWS_S3_PRIVATE_PREFIX=private/
AWS_CLOUDFRONT_DOMAIN=assets.findoly.com
S3_MAX_UPLOAD_MB=20
S3_ALLOWED_EXTENSIONS=.jpg,.jpeg,.png,.webp,.gif,.svg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip
S3_ALLOWED_MIME_TYPES=image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/zip,application/x-zip-compressed,application/octet-stream
AWS_S3_SERVER_SIDE_ENCRYPTION=AES256
```

For KMS encryption:

```env
AWS_S3_SERVER_SIDE_ENCRYPTION=aws:kms
AWS_S3_KMS_KEY_ID=
```

## IAM permissions

The CRM server needs these S3 actions only for the configured bucket and approved prefixes:

- `s3:ListBucket`
- `s3:GetObject`
- `s3:PutObject`

A restricted policy can use the bucket ARN for `ListBucket` and the public/private object-prefix ARNs for `GetObject` and `PutObject`.

## Browser upload CORS

Because uploads use short-lived presigned URLs, configure S3 CORS for the CRM origin. Replace the example origin with the deployed CRM domain.

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["https://admin.findoly.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## CloudFront

Keep the S3 bucket private and use CloudFront for files under `public/`. Set `AWS_CLOUDFRONT_DOMAIN` to display copyable public asset URLs in the CRM.

Replacing an object at the same S3 key may remain cached by CloudFront until its cache expires. Use versioned filenames for frequently changed assets, or invalidate the changed key through the AWS console/deployment process.

## CRM permissions

- `storage.view`: browse, preview and download files.
- `storage.manage`: upload files, replace files and create folders.

The default Admin role receives both permissions. Other roles can be updated from Roles and permissions.
