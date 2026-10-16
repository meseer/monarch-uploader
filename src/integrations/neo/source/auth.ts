/** Neo Financial uses the signed-in browser session for GraphQL requests. */

export function createAuth() {
  return {
    checkStatus() {
      return { authenticated: true };
    },
    getCredentials() {
      return { autoManaged: true };
    },
  };
}

export default { createAuth };
