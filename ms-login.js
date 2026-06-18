require('dotenv').config();
const msal = require('@azure/msal-node');
const fs = require('fs');

const config = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  }
};

const pca = new msal.PublicClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
  }
});

async function login() {
  const deviceCodeRequest = {
    deviceCodeCallback: (response) => {
      console.log('\n' + response.message + '\n');
    },
    scopes: ['Mail.Read', 'Mail.ReadWrite', 'offline_access'],
  };

  try {
    const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    fs.writeFileSync('ms-token.json', JSON.stringify(response, null, 2));
    console.log('\n✅ Login successful! Token saved to ms-token.json');
    console.log('Account:', response.account.username);
  } catch (err) {
    console.error('Login failed:', err.message);
  }
}

login();
