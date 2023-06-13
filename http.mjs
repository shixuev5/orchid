import { Axios } from 'axios';
import axiosRetry from 'axios-retry';

const http = new Axios({});
axiosRetry(http, { retries: 3 });

export {
    http
};
