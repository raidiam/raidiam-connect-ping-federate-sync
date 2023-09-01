// elint-disable-next-line
import { readFileSync } from "fs";

import { config, claimsMapping } from "../config/config.js";
import fetch from "node-fetch";
import https from "https";
import { getLogger } from "./logger.js";
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

    for (const client of clients.payload.items) {
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
      return {
        payload: text,
        status: response.ok,
      };
    }
    if (method === "DELETE") {
      const text = await response.text();
      return {
        payload: text,
        status: response.ok,
      };
    }
    const items = await response.json();
    return {
      payload: items,
      status: response.ok,
    };
  }

  static async createNewClient(directoryClient) {
    const client = this.mergeClient(this.getInitialClient(), directoryClient);
    logger.info(`Creating new client: ${JSON.stringify(client, null, 2)})`);
    await this.fetchFromPingFederate("POST", "", client);
  }

  static async upsertClients(directoryClients) {
    const pfClients = await this.fetchFromPingFederate("GET", "");
    logger.info(`Total existing clients retrieved from Ping Federate including all directory and manually created clients: ${pfClients.payload.items.length}`);

    // Code defensively to ensure that the directory_clients_disabled_list is not empty
    let hasDisabledClients = false;
    let hasIgnoredClients = false;
    let hasFilteredClients = false;
    if (Array.isArray(config.ping_federate_clients_ignore_list) && config.ping_federate_clients_ignore_list.length > 0) {
      logger.info(`Clients that are set to be ignored from any updates at all are: ${config.ping_federate_clients_ignore_list}`);
      hasIgnoredClients = true;
    }
    if (Array.isArray(config.directory_clients_disabled_list) && config.directory_clients_disabled_list.length > 0) {
      logger.info(`Clients that are set to be always disabled are: ${config.directory_clients_disabled_list}`);
      hasDisabledClients = true;
    }
    if (Array.isArray(config.directory_clients_filter_regexs) && config.directory_clients_filter_regexs.length > 0) {
      logger.info(`Clients that are set to be filtered from the directory are: ${config.directory_clients_filter_regexs}`);
      hasFilteredClients = true;
    };
    if (hasDisabledClients && hasIgnoredClients) {
      // If the disabled clients contains any members also in the ignored list log a warning
      const disabledClientsThatAreAlsoIgnored = config.directory_clients_disabled_list.filter(client => config.ping_federate_clients_ignore_list.includes(client));
      if (disabledClientsThatAreAlsoIgnored.length > 0) {
        logger.warn(`The following clients are in the disabled list and the ignore list: ${disabledClientsThatAreAlsoIgnored}. Please note that clients that the ignore list overwrites the disabled list. Clients in the ignore that are also in the disabled list will NOT be disabled.`);
      }
    }
    const disabledDirectoryClients = directoryClients.filter(directoryClient => (directoryClient.status !== "Active" || config.directory_clients_disabled_list.includes(directoryClient.client_id)));
    for (const disabledClient of disabledDirectoryClients) {
      // If the client does not match any of the regex's in the filter list - make no changes to it ever.
      if (hasFilteredClients) {
        const matches = config.directory_clients_filter_regexs.filter(regex => new RegExp(regex).test(disabledClient.client_id));
        if (matches.length === 0) {
          logger.warn(`Client ${disabledClient.client_id} does not match any of the filter regexs this client will not be updated. Skipping...`);
          continue;
        }
      }

      // If the client is in the ignore list - make not changes to it ever.
      if (config.ping_federate_clients_ignore_list.includes(disabledClient.client_id)) {
        logger.warn(`Client ${disabledClient.client_id} is in the ignore list no changes will be made to ping federate. Skipping...`);
        continue;
      }
      const pfClient = pfClients?.payload?.items.find(pfClient => pfClient.clientId === disabledClient.client_id);
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
      // If the client does not match any of the regex's in the filter list - make no changes to it ever.
      if (hasFilteredClients) {
        const matches = config.directory_clients_filter_regexs.filter(regex => new RegExp(regex).test(directoryClient.client_id));
        if (matches.length === 0) {
          logger.warn(`Client ${directoryClient.client_id} does not match any of the filter regexs this client will not be updated. This should be reported to the Directory Operator or the filter regex expressions should be reviewed to ensure that valid clients are not being filtered out. Skipping this client...`);
          continue;
        }
      }
      if (config.ping_federate_clients_ignore_list.includes(directoryClient.client_id)) {
        logger.warn(`Client ${directoryClient.client_id} is in the ignore list no changes will be made to ping federate. Skipping...`);
        continue;
      }

      const pfClient = pfClients?.payload?.items.find(pfClient => pfClient.clientId === directoryClient.client_id);
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
        const updateResult = await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(directoryClient.client_id)}`, mergedClient);
        if (!updateResult.status) {
          logger.error(`Failed to update client ${directoryClient.client_id} in Ping Federate. This client needs to be deactivated as the state is unknown...`);
          if (config.ping_federate_client_delete_instead_of_disable) {
            logger.warn(`Deleting client ${directoryClient.client_id}...`);
            await this.fetchFromPingFederate("DELETE", `/${encodeURIComponent(pfClient.clientId)}`);
          } else {
            logger.info(`Disabling client ${pfClient.clientId}...`);
            pfClient.enabled = false;
            const deactivateResult = await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(pfClient.clientId)}`, pfClient);
          }
        }
      } else {
        logger.info(`Client ${directoryClient.client_id} does not exist in Ping Federate but exists in the directory...`);
        // This is where we can be a bit defensive in terms of checking for invalid clients
        // Skip clients without grant types or redirect uris
        if (!directoryClient.redirect_uris || directoryClient.redirect_uris.length === 0) {
          logger.warn(`Client ${directoryClient.client_id} has no redirect URIs. Skipping...`);
          logger.debug(`Skipped Client: ${JSON.stringify(directoryClient, null, 2)})`);
          continue;
        }
        if (!directoryClient.grant_types || directoryClient.grant_types.length === 0) {
          logger.warn(`Client ${directoryClient.client_id} has no grant types. Skipping...`);
          logger.debug(`Skipped Client: ${JSON.stringify(directoryClient, null, 2)})`);
          continue;
        }
        logger.info(`Client ${directoryClient.client_id} does not exist in Ping Federate. Creating...`);
        await this.createNewClient(directoryClient);
        logger.debug("Client created.");
      }
    }

    // Loop through all ping federate clients and remove those that are not in the activeClients list or the disabledClients list but have an extended property of register_last_updated
    const allPingFederateClients = pfClients?.payload?.items;
    for (const pfClient of allPingFederateClients) {
      if (activeDirectoryClients.find(activeDirectoryClient => activeDirectoryClient.client_id === pfClient.clientId) || disabledDirectoryClients.find(disabledDirectoryClient => disabledDirectoryClient.client_id === pfClient.clientId)) {
        // If the client exists in the active list or the disabled list then it should not be deleted
        continue;
      }
      if (pfClient.extendedParameters?.register_last_updated?.values?.[0]) {
        // If delete instead of disable is set to true then delete the client
        if (config.ping_federate_client_delete_instead_of_disable) {
          logger.info(`Deleting client ${pfClient.clientId} as it has an extended property of register_last_updated but is no longer listed in the Directory of Participants at all...`);
          await this.fetchFromPingFederate("DELETE", `/${encodeURIComponent(pfClient.clientId)}`);
          logger.debug("Client deleted.");

          // Otherwise disable the client
        } else {
          if (pfClient.enabled) {
            logger.info(`Disabling client ${pfClient.clientId} as it has an extended property of register_last_updated but is no longer listed in the Directory of Participants at all...`);
            pfClient.enabled = false;
            await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(pfClient.clientId)}`, pfClient);
            logger.debug("Client disabled.");
          }
        }
      }
    }
  }

  static mergeClient(existingPfClient, directoryClient) {
    // Deep clone the object to return a new one
    const clientRecord = JSON.parse(JSON.stringify(existingPfClient));
    clientRecord.redirectUris = directoryClient.redirect_uris;
    clientRecord.grantTypes = directoryClient.grant_types.map(str => str.toUpperCase()); ;
    clientRecord.name = directoryClient.client_name;
    clientRecord.restrictedResponseTypes = directoryClient.response_types;
    clientRecord.description = directoryClient.client_description;
    clientRecord.oidcPolicy.sectorIdentifierUri = directoryClient.sector_identifier_uri;
    clientRecord.enabled = directoryClient.status === "Active";
    clientRecord.jwksSettings.jwksUrl = directoryClient.jwks_uri;
    clientRecord.logoUrl = directoryClient.logo_uri;
    clientRecord.clientId = directoryClient.client_id;

    for (const [key, value] of Object.entries(claimsMapping)) {
      if (directoryClient[key]) {
        clientRecord.extendedParameters[value] = { ...(Array.isArray(directoryClient[key]) ? { values: directoryClient[key] } : { values: [directoryClient[key]] }) };
      } else {
        clientRecord.extendedParameters[value] = {
          values: [],
        };
      }
    }

    return clientRecord;
  }
}

export default PingFederateClientManager;
