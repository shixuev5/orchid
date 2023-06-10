import { Axios } from 'axios';
import axiosRetry from 'axios-retry';

const http = new Axios({ proxy: { host: '127.0.0.1', port: '33210', protocol: 'http' } });
axiosRetry(http, { retries: 3 });

export {
    http
};
