import data from './pf-createClient.json' assert { type: 'json' };
import { config } from './config.js';
import fetch from 'node-fetch';
import https from 'https';
import { Logger } from 'winston'
import { getLogger } from './logger.js';
const logger = getLogger(config.log_level)

const customHeaders = {
    "Content-Type": "application/json",
    "X-XSRF-Header": "PingFederate",
    "Authorization": `Basic ${Buffer.from(`${config.ping_federate_admin_username}:${config.ping_federate_admin_password}`).toString('base64')}`
};


const httpsAgent = new https.Agent({
    rejectUnauthorized: config.ping_federate_connection_reject_unauthorized
});

class PingFederateClientManager {
    static getInitialClient() {
        return JSON.parse(JSON.stringify(data));
    }
    static async fetchFromPingFederate(method, endpoint, body = null) {
        const options = {
            agent: httpsAgent,
            method,
            headers: customHeaders
        };

        if (body) {
            options.body = JSON.stringify(body);
        }
        else {
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
        logger.info(`Total existing clients retrieved from Ping Federate: ${pfClients.items.length}`);
    
        const disabledDirectoryClients = directoryClients.filter(directoryClient => directoryClient.status !== "Active");
        for (const disabledClient of disabledDirectoryClients) {
            const pfClient = pfClients.items.find(pfClient => pfClient.clientId === disabledClient.client_id);
            if (pfClient) {
                logger.info(`Client ${disabledClient.client_id} exists in Ping Federate and needs to be disabled...`);
                if (config.ping_federate_client_delete_instead_of_disable) {
                    logger.warn(`Deleting client ${disabledClient.client_id}...`);
                    await this.fetchFromPingFederate("DELETE", `/${encodeURIComponent(disabledClient.client_id)}`);
                } else {
                    logger.info(`Disabling client ${disabledClient.client_id}...`);
                    pfClient.enabled = false;
                    await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(disabledClient.client_id)}`, this.mergeClient(pfClient, disabledClient));
                }
                logger.debug("Done.");
            }
        }
    
        const activeDirectoryClients = directoryClients.filter(directoryClient => directoryClient.status === "Active");
        for (const directoryClient of activeDirectoryClients) {
            if (!directoryClient.redirect_uris || directoryClient.redirect_uris.length === 0) {
                logger.warn(`Client ${directoryClient.client_id} has no redirect URIs. Skipping...`);
                logger.debug(`Skipped Client: ${JSON.stringify(directoryClient, null, 2)})`);
                continue;
            }
    
            const pfClient = pfClients.items.find(pfClient => pfClient.clientId === directoryClient.client_id);
            if (!config.resync_clients_retrieved_from_directory && pfClient && pfClient.extendedParameters.register_last_updated?.values?.[0] === directoryClient.last_updated) {
                logger.debug(`Client ${directoryClient.client_id} already exists in Ping Federate and has not been updated in the directory. Skipping...`);
            } else if (pfClient) {
                if (config.resync_clients_retrieved_from_directory) {
                    logger.warn(`Client will be force synced from directory because resync_clients_retrieved_from_directory is true: ${directoryClient.client_id}...`);
                }
                logger.info(`Client ${directoryClient.client_id} already exists in Ping Federate but needs updating. Updating...`);
                const mergedClient = this.mergeClient(pfClient, directoryClient);
                await this.fetchFromPingFederate("PUT", `/${encodeURIComponent(directoryClient.client_id)}`, mergedClient);
                logger.debug("Client updated.");
            } else {
                logger.info(`Client ${directoryClient.client_id} does not exist in Ping Federate. Creating...`);
                await this.createNewClient(directoryClient);
            }
        }
    }
    

    static mergeClient(existingPfClient, directoryClient) {
        
            existingPfClient.redirectUris = directoryClient.redirect_uris;
            existingPfClient.grantTypes = directoryClient.grant_types.map(str => str.toUpperCase());;
            existingPfClient.name = directoryClient.client_name;
            existingPfClient.restrictedResponseTypes = directoryClient.response_types;
            existingPfClient.description = directoryClient.client_description;
            existingPfClient.oidcPolicy.sectorIdentifierUri = directoryClient.sector_identifier_uri;
            existingPfClient.enabled = directoryClient.status === "Active" ? true : false
            existingPfClient.jwksSettings.jwksUrl = directoryClient.jwks_uri;
            existingPfClient.logoUrl = directoryClient.logo_uri;
            existingPfClient.clientId = directoryClient.client_id;
            if (directoryClient.organisation_id) {
                existingPfClient.extendedParameters.organisation_id = {
                    values: [directoryClient.organisation_id]
                }
            }
            else {
                existingPfClient.extendedParameters.organisation_id = {
                    values: []
                }
            }
            if (directoryClient.software_id) {
                existingPfClient.extendedParameters.software_id = {
                    values: [directoryClient.software_id]
                }
            }
            else {
                existingPfClient.extendedParameters.software_id = {
                    values: []
                }
            }
            if (directoryClient.software_version) {
                existingPfClient.extendedParameters.software_version = {
                    values: [directoryClient.software_version]
                }
            }
            else {
                existingPfClient.extendedParameters.software_version = {
                    values: []
                }
            }
        
            if (directoryClient.claims) {
                existingPfClient.extendedParameters.claims = {
                    values: directoryClient.claims
                }   
            }
            else {
                existingPfClient.extendedParameters.claims = {
                    values: []
                }
            }
            if (directoryClient.last_updated) {
                existingPfClient.extendedParameters.register_last_updated = {
                    values: [directoryClient.last_updated]
                }   
            }
            else {
                existingPfClient.extendedParameters.register_last_updated = {
                    values: []
                }   
            }
        
            return existingPfClient;
        }
    }

export default PingFederateClientManager;
