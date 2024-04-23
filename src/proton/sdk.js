// Library boundary only. Implementation is supplied by the declared Proton dependency.
import './byte-compat.js';
import { CryptoProxy } from '@protontech/crypto';
import { Api } from '@protontech/crypto/proxy/endpoint/api.ts';
Api.init({});
CryptoProxy.setEndpoint(new Api());
export { getSrp, computeKeyPassword } from '@protontech/crypto/srp';
