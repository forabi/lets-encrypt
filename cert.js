#! /bin/node

// @ts-check
const shelljs = require('shelljs');
const executeCommands = require('@hollowverse/common/helpers/executeCommands');

const { EMAIL, DOMAIN, CERT_NAME, STORAGE_BUCKET_ID } = require('./config');

const SYNC_ROOT = `/etc/letsencrypt/`;

async function main() {
  const code = await executeCommands([
    // Authenticate to Google Cloud Platform
    'gcloud auth activate-service-account --key-file /gcloud.letsEncrypt.json',

    // Restore previous certificate files from Cloud Storage (if any)
    `gsutil -q -m rsync -r ${SYNC_ROOT} gs://${STORAGE_BUCKET_ID}`,

    // Create or update Let's Encrypt certificate if needed
    `certbot certonly \
      --agree-tos \
      --email ${EMAIL} \
      --noninteractive \
      --webroot \
      --webroot-path ./public \
      -d ${DOMAIN}
    `,

    () => {
      // This directory contains the certificate files, including the private key
      shelljs.cd(`/etc/letsencrypt/live/${DOMAIN}/`);
      return 0;
    },

    // Convert private key to GAE-compatible format
    'openssl rsa -in ./privkey.pem -out ./rsa.pem',

    /**
     * Checks if a certificate listing is stored in App Engine settings and if so,
     * updates it with the newly created certificate.
     * If no listing is found, a new one is created and the certificate is saved under
     * that listing.
     */
    function createOrUpdateAppEngineCertListing() {
      // Find the certificate ID that matches the certificate display name
      const result = shelljs.exec(
        `gcloud beta app ssl-certificates list --filter ${CERT_NAME} --limit 1`,
      );

      if (result.code === 0) {
        let certId;

        // Take the second line of output (the first one is column headings)
        const certLine = result.stdout.split('\n')[1];

        if (certLine) {
          const matches = certLine.match(/^([0-9]+)\s/i);
          if (matches && matches[1]) {
            certId = matches[1];
          }
        }

        const commands = [];
        if (!certId) {
          // Create a new certificate if no matching certificate ID is found
          commands.push(`
            gcloud beta app ssl-certificates create \
            --display-name ${CERT_NAME} \
            --certificate ./fullchain.pem \
            --private-key ./rsa.pem
          `);
        } else {
          // Otherwise, update the existing one
          commands.push(`
            gcloud beta app ssl-certificates update ${certId} \
            --certificate ./fullchain.pem \
            --private-key ./rsa.pem
          `);
        }
        return executeCommands(commands);
      }

      console.error(`Failed to get the certificate list: ${result.stderr}`);
      return result.code;
    },

    // Upload the newly created certificate files to Cloud Storage (if any)
    `gsutil -q -m rsync -r ${SYNC_ROOT} gs://${STORAGE_BUCKET_ID}`,
  ]);

  process.exit(code);
}

main();
