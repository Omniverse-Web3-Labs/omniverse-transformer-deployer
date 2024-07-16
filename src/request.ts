import axios from 'axios';

const axiosInstance = axios.create();

export class Request {
    url: string;

    constructor(url: string) {
        this.url = url;
    }

    async post(params: any) {
        const instance = axiosInstance;
        const response = await instance.post(this.url, params);
        return response.data;
    }

    async rpc(method: string, params: any) {
        try {
            let response = await this.post({
                jsonrpc: '2.0',
                method: method,
                params,
                id: new Date().getTime()
            });
            if (response.error) {
                console.error('request error: ', response.error);
                throw new Error('request error: ');
            }
            return response.result;
        } catch (e) {
            console.error('network error: ' + e);
            throw e;
        }
    }
}
