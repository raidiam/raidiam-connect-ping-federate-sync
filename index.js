import { Issuer, custom } from 'openid-client';
import { config } from './config.js';
import PingFederateClientManager from './pf-admin.js';
import { Logger } from 'winston'
import { getLogger } from './logger.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
const logger = getLogger(config.log_level)


async function discoverIssuer() {
    logger.info("Discovering issuer...");
    const directoryIssuer = await Issuer.discover(config.directory_issuer);
    logger.info(`Discovered issuer ${directoryIssuer.issuer}`, directoryIssuer.metadata);
    return directoryIssuer;
}

async function createDirectoryClient(directoryIssuer) {
    logger.info("Creating directory client...");
    const directoryClient = new directoryIssuer.Client({
        client_id: config.directory_client_id,
        response_types: [],
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'tls_client_auth',
    });

    directoryClient[custom.http_options] = function(url, options) {

        return {
            ... (config.https_proxy ? { agent: new HttpsProxyAgent(config.https_proxy, { rejectUnauthorized: config.directory_tls_reject_unauthorized }) } : {}),
            cert: config.directory_client_cert,
            key: config.directory_client_key,
            ca: config.directory_client_ca
        };
    };

    logger.info("Directory client created.");
    return directoryClient;
}

export async function fetchClients(directoryClient, accessToken) {
    logger.info("Requesting clients... note that pages are zero-indexed.");
    let mergedClients = [];
    let page = 0;
    let totalPages;
    let totalRecords;
    
    const currentDate = new Date(); 

    const daysAgo = new Date(currentDate.getTime() - (config.lookback_days * 24 * 60 * 60 * 1000)); // Subtracts a configurable days worth of milliseconds from the current date
    logger.info(`Will request updates from the directory for updates made ${config.lookback_days} days ago: ${daysAgo}`);

    do {
        logger.info(`Requesting clients page ${page}...`);
        const clients = await directoryClient.requestResource(`${config.directory_clients_endpoint}?role=RP-CORE&page=${page}&startDate=${encodeURIComponent(daysAgo.toISOString())}`, accessToken);
        const clientsJson = JSON.parse(clients.body);

        if (page === 0) {
            totalPages = clientsJson.totalPages;
            totalRecords = clientsJson.totalSize;
        }

        if (clientsJson?.content?.length > 0) {
            mergedClients.push(...clientsJson.content);
        }

        page++;
    } while (page <= totalPages - 1);

    if (totalRecords !== mergedClients.length) {
        logger.error("WARNING: Total records received does not match the total records in the directory.");
        logger.error(`Total records in directory: ${totalRecords}`);
        logger.error(`Total records received: ${mergedClients.length}`);
        throw new Error("Record count mismatch");
    }

    return mergedClients;
}

export async function main() {
    logger.info("Raidim Connect Ping Federate Client Sync");
    logger.info("=========================================");

    try {
        const directoryIssuer = await discoverIssuer();
        const directoryClient = await createDirectoryClient(directoryIssuer);

        logger.info("=========================================");
        logger.info("Requesting access token...");
        const at = await directoryClient.grant({ grant_type: 'client_credentials', scope: config.directory_scope });
        logger.info('Access token issued');

        const mergedClients = await fetchClients(directoryClient, at.access_token);

        logger.info("=========================================");
        logger.info(`Updating clients in Ping Federate that have been updated in the directory in the last ${config.lookback_days} days...`);
        await PingFederateClientManager.upsertClients(mergedClients);
        logger.info("Raidiam Connect Ping Federate Sync Execution Completed... Please review the logs for any errors processing updates.")
    } catch (error) {
        console.error("An error occurred:", error);
    }
}

if (process.env.TEST === 'true') {

}
else {
    main();
}
