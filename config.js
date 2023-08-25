import fs from 'fs';
export const config = {
    directory_issuer: "https://auth.directory.sandbox.connectid.com.au",
    directory_client_id: "https://rp.directory.sandbox.connectid.com.au/openid_relying_party/a6a91e85-0891-4ce8-b7d0-3fafa85cd2f5",
    directory_scope: "directory:software",
    directory_clients_endpoint: "https://matls-api.directory.sandbox.connectid.com.au/clients",
    directory_client_cert: fs.readFileSync('./certs/transport.pem'),
    directory_client_key: fs.readFileSync('./certs/transport.key'),
    directory_client_ca: fs.readFileSync('./certs/ca.pem'),
    ping_federate_admin_uri: "https://localhost:9999/pf-admin-api/v1/oauth/clients",
    ping_federate_admin_username: "Administrator",
    ping_federate_admin_password: "2FederateM0re",
    lookback_days: 7,
    ping_federate_connection_reject_unauthorized: false,
    ping_federate_client_delete_instead_of_disable: true,
    resync_clients_retrieved_from_directory: false,
    log_level: 'debug' // info or debug
}