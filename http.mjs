import axios from 'axios';
import axiosRetry from 'axios-retry';

const http = axios.create({});
axiosRetry(http, { retries: 3 });

export {
    http
};
