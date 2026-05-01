// Attach `Authorization: Bearer <apiKey>` to every outbound request.
const includeBearer = (request, z, bundle) => {
  if (bundle.authData?.apiKey) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  }
  return request;
};

// Surface a friendly error when the API returns 401/403.
const handleErrors = (response /*, z, bundle */) => {
  if (response.status === 401) {
    throw new Error(
      'Your StoryVenue API key is invalid or has been revoked. ' +
        'Re-issue a key in Settings → Integrations and reconnect this Zap.',
    );
  }
  if (response.status === 403) {
    throw new Error(
      'This API key does not have the required permissions. ' +
        'Check the key scopes in Settings → Integrations.',
    );
  }
  return response;
};

module.exports = { includeBearer, handleErrors };
