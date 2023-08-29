import fs from "fs";
export const config = {
  directory_issuer: "https://matls-auth.directory.sandbox.connectid.com.au",
  directory_issuer_mtls_protected: true,
  directory_client_id: "https://rp.directory.sandbox.connectid.com.au/openid_relying_party/a6a91e85-0891-4ce8-b7d0-3fafa85cd2f5",
  directory_scope: "directory:software",
  directory_clients_endpoint: "https://matls-api.directory.sandbox.connectid.com.au/clients",
  directory_client_cert: fs.readFileSync("./certs/transport.pem"),
  directory_client_key: fs.readFileSync("./certs/transport.key"),
  directory_client_ca: fs.readFileSync("./certs/ca.pem"),
  directory_tls_reject_unauthorized: true,
  directory_clients_disabled_list: ["https://rp.directory.sandbox.connectid.com.au/openid_relying_party/a8009f3d-1dd2-4840-9cda-b029db1b7878"], // This list will always be disabled even if the directory says they are active
  ping_federate_clients_ignore_list: ["https://rp.directory.sandbox.connectid.com.au/openid_relying_party/a8009f3d-1dd2-4840-9cda-b029db1b7878"], // This list of clientIds in Ping Federate will never be modified
  ping_federate_admin_uri: "https://localhost:9999/pf-admin-api/v1/oauth/clients",
  ping_federate_admin_username: "Administrator",
  ping_federate_admin_password: "2FederateM0re",
  lookback_days: 10,
  ping_federate_connection_reject_unauthorized: false,
  ping_federate_client_delete_instead_of_disable: false,
  resync_clients_retrieved_from_directory: false,
  log_level: "debug", // info or debug
  https_proxy: "http://localhost:3128",
};

// Directoy claims to ping federate extended attributes mapping
// This will be used to map attributes from the directory clients json object which is typically RFC compliant to the Ping Federate extended attributes which are user defined
// e.g
export const claimsMapping = {
  last_updated: "register_last_updated",
  organisation_id: "organisation_id",
  software_id: "software_id",
  software_version: "software_version",
  claims: "claims",
};
