# Raidim Connect Ping Federate Client Sync

## Overview

This project is designed to synchronize OAuth clients between a directory service and a Ping Federate instance. It fetches OAuth client data from a directory service and either creates new clients or updates existing clients in Ping Federate based on certain conditions.

The solution is designed to be easily tailored to Ping Federate deployments recognising that different implementations will have extended their OAuth client configuration with additional metadata that's unique to each deployment.

To be as flexible as possible, the client template `clientDefinition.json` has been taken directly from the Ping Federate swagger that is available on `https://pf-host:9999/pf-admin-api/api-docs/#/%2Foauth%2Fclients/createClient`. This should ensure that any changes to the base ping federate client object or client definition can be incorporated simply by updating this object.

## Detailed Logic

### Discover Directory Issuer

The application starts by discovering the directory issuer using its URL. This is essential for establishing a trusted connection and for subsequent interactions with the directory service.

### Create Directory Client

A client is then created for the directory issuer. This client is used to fetch OAuth clients from the directory service. The client is configured with specific credentials and settings, including client certificates for secure communication.

### Fetch Clients

OAuth clients are fetched from the directory service. The application supports pagination and will fetch all available pages of clients. Each client contains various attributes like `client_id`, `redirect_uris`, `grant_types`, etc.

### Synchronize Clients

Each client fetched from the directory service undergoes the following logic:

1. **Check for Existence**: The application first checks if the client already exists in Ping Federate.
2. **Conditional Updates**: If the client exists and has not been updated recently in the directory, it is skipped. Otherwise, it is updated in Ping Federate.
3. **Creation**: If the client does not exist in Ping Federate, a new client is created.

## Why Use an Initial Client Object?

The initial client object serves as a template for creating new clients in Ping Federate. It contains default settings that are common to all clients, ensuring a consistent configuration baseline. This object is essentially the input object for the Ping Federate Admin API and includes various fields like:

- `clientId`: The client ID.
- `enabled`: Whether the client is enabled.
- `redirectUris`: The URIs to which the client can redirect.
- `grantTypes`: The types of OAuth grants the client can use.
- ... (and many more)

Here's a breakdown of some key fields:

- `oidcPolicy`: Contains OpenID Connect specific settings.
- `clientAuth`: Specifies how the client should authenticate with the Ping Federate server.
- `jwksSettings`: Specifies the URL where the client's JSON Web Key Set can be fetched.
- `extendedParameters`: Allows for additional custom parameters.

By using this initial client object, the application can easily merge attributes fetched from the directory service, thereby creating or updating clients in Ping Federate with the desired configuration.

## Configuration

The application is configured via a `config.js` file. Below are the configuration options:

### Directory Service Configuration

- `directory_issuer`: The URL of the directory issuer. This is used to discover the directory's OpenID configuration.
- `directory_client_id`: The client ID for the directory service.
- `directory_scope`: The scope for which the directory service will issue an access token.
- `directory_clients_endpoint`: The API endpoint to fetch clients from the directory service.

### Directory Client Security Configuration

- `directory_client_cert`: Path to the client certificate for mutual TLS authentication with the directory service.
- `directory_client_key`: Path to the private key corresponding to the client certificate.
- `directory_client_ca`: Path to the CA certificate for the directory service.

### Ping Federate Configuration

- `ping_federate_admin_uri`: The URI for the Ping Federate admin API.
- `ping_federate_admin_username`: Username for the Ping Federate admin API.
- `ping_federate_admin_password`: Password for the Ping Federate admin API.

### Miscellaneous Configuration

- `lookback_days`: Number of days to look back for updates in the directory service.
- `ping_federate_connection_reject_unauthorized`: Boolean to indicate whether to reject unauthorized SSL certificates when connecting to Ping Federate.
- `ping_federate_client_delete_instead_of_disable`: Boolean to indicate whether to delete clients in Ping Federate instead of disabling them.
- `resync_clients_retrieved_from_directory`: Boolean to indicate whether to force resync active clients against ping federate.
- `https_proxy`: String to point to a CONNECT tunnel proxy like squid proxy. Null by default.

### Extended attributes claims mappings

The utility has a means of mapping any claims from the Directory to Ping Federates OAuth extended attributes simply by adding elements to the following map. Any entry included in the Clients API Response can be referenced, even those that are already used as part of standard claims. The program will take a property from the DirectoryClients record and add it as an extended oAuth client attribute to Ping Federate Extended Properties[https://docs.pingidentity.com/r/en-us/pingfederate-112/help_extendedpropertiestasklet_extendedpropertiesstate]. Please note that all properties are specified as an array of multiple values even if you only wish to store a single property.

WARNING: The extended oauth attributes that are being written must already have been created in Ping Federate. Failing to create these first will result in the client updates failing to be written correctly.

```Javascript
export const claimsMapping = {
    last_updated: "register_last_updated",
    organisation_id: "organisation_id",
    software_id: "software_id",
    software_version: "software_version",
    claims: "claims"
}
```

## Setup

### Prerequisites

- Node.js installed on your machine.
- Access to a Ping Federate instance.
- Access to a Raidiam Connect directory service that supports OAuth 2.0 and OpenID Connect.

### Steps

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/raidiam/raidim-connect-ping-federate-client-sync.git
   ```

2. **Navigate to the Project Directory**:

   ```bash
   cd raidim-connect-ping-federate-client-sync
   ```

3. **Install Dependencies**:

   ```bash
   npm install
   ```

4. **Configure the Application**:

   Open the `config/config.js` file and update it with your specific settings. Make sure to place your certificate, key, and CA files in the appropriate locations and update their paths in the `config/config.js` file.

5. **Configure your default Ping Federate client configurationn**:

   Open the `clientDefinition.json` file and update it with your specific settings. This file is simply an extra from the PF Admin API payload for creating a new oAuth client. This file allows you to specify items that are unique to your deployment including ATManagerIds OIDCPolicyIDs and any specific extension attributes you wish to configure into every client. For more details on this payload please refer to the Ping Fed Admin API Swagger Documentation in the Ping Fed Manual.

6. **Run the Application**:

   ```bash
   node index.js
   ```

## Testing

Testing of the client synchronisation utility is challenging given that it is primarily an integrating tool. Several mock functions have been written to validate basic logic against simulated payloads.

## Logging

The utility leverages the Winston logging framework and by default logs to standard out as well as creating a log file that will rotate daily in the logs sub folder. The log file is published in JSON format for easy ingestion into logging SIEM services but can be conifgured using any of the options here `https://github.com/winstonjs/winston`
