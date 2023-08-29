// elint-disable-next-line
import { readFileSync } from "fs";

import { config, claimsMapping } from "../config/config.js";
import fetch from "node-fetch";
import https from "https";
import { Logger } from "winston";
import { getLogger } from "./logger.js";
import assert from "assert";
const pingFederateInitialClient = JSON.parse(readFileSync("./config/clientDefinition.json"));
const logger = getLogger(config.log_level);

const customHeaders = {
  "Content-Type": "application/json",
  "X-XSRF-Header": "PingFederate",
  Authorization: `Basic ${Buffer.from(`${config.ping_federate_admin_username}:${config.ping_federate_admin_password}`).toString("base64")}`,
};

const httpsAgent = new https.Agent({
  rejectUnauthorized: config.ping_federate_connection_reject_unauthorized,
});

class PingFederateClientManager {
  static getInitialClient() {
    return JSON.parse(JSON.stringify(pingFederateInitialClient));
  }

  static async deleteAllCilents() {
    const clients = await this.fetchFromPingFederate("GET", "");

    for (const client of clients.items) {
      logger.info(`Deleting client ${client.clientId}...`);
      await this.fetchFromPingFederate("DELETE", `/${encodeURIComponent(client.clientId)}`);
      logger.debug("Done.");
    }
  }

  static async fetchFromPingFederate(method, endpoint, body = null) {
    const options = {
      agent: httpsAgent,
      method,
      headers: customHeaders,
    };

    if (body) {
      options.body = JSON.stringify(body);
    } else {
      options.body = null;
    }

    const response = await fetch(`${config.ping_federate_admin_uri}${endpoint}`, options);
    if (!response.ok) {
      const text = await response.text();
      logger.error(`Failed to perform ${method} operation against Ping Federate resource ${config.ping_federate_admin_uri}${endpoint} resulting in error ${text}. The payload used was ${JSON.stringify(body, null, 2)}`);
      return text;
    }
    if (method === "DELETE") {
      return response.text();
    }
    return response.json();
  }

  static async createNewClient(directoryClient) {
    const client = this.mergeClient(this.getInitialClient(), directoryClient);
    logger.info(`Creating new client: ${JSON.stringify(client, null, 2)})`);
    await this.fetchFromPingFederate("POST", "", client);
  }

  static async upsertClients(directoryClients) {
    const pfClients = await this.fetchFromPingFederate("GET", "");
    logger.info(`Total existing clients retrieved from Ping Federate including all directory and manually created clients: ${pfClients.items.length}`);

    // Code defensively to ensure that the directory_clients_disabled_list is not empty
    let hasDisabledClients = false;
    let hasIgnoredClients = false;
    if (Array.isArray(config.ping_federate_clients_ignore_list) && config.ping_federate_clients_ignore_list.length > 0) {
      logger.info(`Clients that are set to be ignored from any updates at all are: ${config.ping_federate_clients_ignore_list}`);
      hasIgnoredClients = true;
    }
    if (Array.isArray(config.directory_clients_disabled_list) && config.directory_clients_disabled_list.length > 0) {
      logger.info(`Clients that are set to be always disabled are: ${config.directory_clients_disabled_list}`);
      hasDisabledClients = true;
    }
    if (hasDisabledClients && hasIgnoredClients) {
      // If the disabled clients contains any members also in the ignored list log a warning
      const disabledClientsThatAreAlsoIgnored = config.directory_clients_disabled_list.filter(client => config.ping_federate_clients_ignore_list.includes(client));
      if (disabledClientsThatAreAlsoIgnored.length > 0) {
        logger.warn(`The following clients are in the disabled list and the ignore list: ${disabledClientsThatAreAlsoIgnored}. Please note that clients that the ignore list overwrites the disabled list. Clients in the ignore that are also in the disabled list will NOT be disabled.`);
      }
    }
    const disabledDirectoryClients = directoryClients.filter(directoryClient => (directoryClient.status !== "Active" || config.directory_clients_disabled_list.includes(directoryClient.client_id)));
    for (const disabledClient of disabledDirectoryClients) {
      // If the client is in the ignore list - make not changes to it ever.
      if (config.ping_federate_clients_ignore_list.includes(disabledClient.client_id)) {
        logger.warn(`Client ${disabledClient.client_id} is in the ignore list no changes will be made to ping federate. Skipping...`);
        continue;
      }
      const pfClient = pfClients.items.find(pfClient => pfClient.clientId === disabledClient.client_id);
      if (pfClient) {
        if (config.ping_federate_client_delete_instead_of_disable) {
          logger.info(`Client ${disabledClient.client_id} exists in Ping Federate and needs to be disabled, because ping_federate_client_delete_instead_of_disable is set to true the client will be deleted...`);
          await this.fetchFromPingFederate("DELETE", `/${encodeURIComponent(disabledClient.client_id)}`);
          logger.info(`Client ${disabledClient.client_id} deleted...`);
        } else {
          if (pfClient.enabled !== true) {
            logger.info(`Client ${disabledClient.client_id} is already disabled in Ping Federate. Skipping...`);
            continue;
          }
          if (config.directory_clients_disabled_list.includes(disabledClient.client_id)) {
            logger.warn(`Client ${disabledClient.client_id} is in the always disabled list and will be disabled...`);
            disabledClient.status = "Inactive"; // This overwrites whatever might be in the directory with a status that is not Active;
            pfClient.enabled = false;
          }
          logger.info(`Client ${disabledClient.client_id} exists in Ping Federate and needs to be disabled...`);
          await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(disabledClient.client_id)}`, this.mergeClient(pfClient, disabledClient));
          logger.info(`Client ${disabledClient.client_id} disabled...`);
        }
      }
    }

    const activeDirectoryClients = directoryClients.filter(directoryClient => directoryClient.status === "Active" && !config.directory_clients_disabled_list.includes(directoryClient.client_id));
    for (const directoryClient of activeDirectoryClients) {
      if (config.ping_federate_clients_ignore_list.includes(directoryClient.client_id)) {
        logger.warn(`Client ${directoryClient.client_id} is in the ignore list no changes will be made to ping federate. Skipping...`);
        continue;
      }

      if (!directoryClient.redirect_uris || directoryClient.redirect_uris.length === 0) {
        logger.warn(`Client ${directoryClient.client_id} has no redirect URIs. Skipping...`);
        logger.debug(`Skipped Client: ${JSON.stringify(directoryClient, null, 2)})`);
        continue;
      }

      const pfClient = pfClients.items.find(pfClient => pfClient.clientId === directoryClient.client_id);
      if (!config.resync_clients_retrieved_from_directory && pfClient && pfClient.extendedParameters.register_last_updated?.values?.[0] === directoryClient.last_updated && pfClient.enabled === true) {
        logger.debug(`Client ${directoryClient.client_id} already exists in Ping Federate and there has not been any updates to the client based on the clients last updated time on the directory. Skipping...`);
      } else if (pfClient) {
        if (config.resync_clients_retrieved_from_directory) {
          logger.warn(`Client will be force synced from directory because resync_clients_retrieved_from_directory is true: ${directoryClient.client_id}...`);
        }
        if (pfClient.extendedParameters.register_last_updated?.values?.[0] !== directoryClient.last_updated) {
          logger.info(`Client ${directoryClient.client_id} already exists in Ping Federate but needs updating as there is a newer record on the directory. Updating...`);
        }
        if (pfClient.enabled !== true) {
          logger.info(`Client ${directoryClient.client_id} already exists in Ping Federate but needs updating as it is disabled in Ping Federate. Updating...`);
        }
        const mergedClient = this.mergeClient(pfClient, directoryClient);
        await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(directoryClient.client_id)}`, mergedClient);
        logger.debug("Client updated.");
      } else {
        logger.info(`Client ${directoryClient.client_id} does not exist in Ping Federate. Creating...`);
        await this.createNewClient(directoryClient);
        logger.debug("Client created.");
      }
    }
  }

  static mergeClient(existingPfClient, directoryClient) {
    existingPfClient.redirectUris = directoryClient.redirect_uris;
    existingPfClient.grantTypes = directoryClient.grant_types.map(str => str.toUpperCase()); ;
    existingPfClient.name = directoryClient.client_name;
    existingPfClient.restrictedResponseTypes = directoryClient.response_types;
    existingPfClient.description = directoryClient.client_description;
    existingPfClient.oidcPolicy.sectorIdentifierUri = directoryClient.sector_identifier_uri;
    existingPfClient.enabled = directoryClient.status === "Active";
    existingPfClient.jwksSettings.jwksUrl = directoryClient.jwks_uri;
    existingPfClient.logoUrl = directoryClient.logo_uri;
    existingPfClient.clientId = directoryClient.client_id;

    for (const [key, value] of Object.entries(claimsMapping)) {
      if (directoryClient[key]) {
        existingPfClient.extendedParameters[value] = { ...(Array.isArray(directoryClient[key]) ? { values: directoryClient[key] } : { values: [directoryClient[key]] }) };
      } else {
        existingPfClient.extendedParameters[value] = {
          values: [],
        };
      }
    }

    return existingPfClient;
  }
}

export default PingFederateClientManager;
