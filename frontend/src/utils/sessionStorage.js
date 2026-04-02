// Client ID / Session tracking for "My Jobs" filtering
export const getClientId = () => {
  let clientId = sessionStorage.getItem('clientId');
  if (!clientId) {
    clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('clientId', clientId);
  }
  return clientId;
};

export const isMyJob = (job) => {
  if (!job) return false;
  // Check if job has isMyJob flag
  if (job.isMyJob === true) return true;
  // Check if job's clientId matches current session
  const clientId = getClientId();
  return job.clientId === clientId;
};
