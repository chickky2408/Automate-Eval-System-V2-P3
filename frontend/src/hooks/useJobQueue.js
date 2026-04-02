import { useTestStore } from '../store/useTestStore';

export const useJobQueue = () => {
  const { jobQueue, updateJobStatus, removeJob, reorderJobs } = useTestStore();

  const runJob = (id) => {
    // Logic สำหรับส่งสัญญาณไปหา Hardware/Backend
    console.log(`Starting Job: ${id}`);
    updateJobStatus(id, 'running');
  };

  const stopJob = (id, mode = 'immediate') => {
    // mode: 'immediate' (หยุดทันที) หรือ 'graceful' (รอจบคิว)
    console.log(`Stopping Job: ${id} with mode: ${mode}`);
    updateJobStatus(id, 'stopped');
  };

  const editJobOrder = (fromIndex, toIndex) => {
    const newQueue = Array.from(jobQueue);
    const [movedItem] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, movedItem);
    reorderJobs(newQueue);
  };

  const runBatch = () => {
    console.log("Starting Batch Execution...");
    jobQueue.forEach((job, index) => {
      
      setTimeout(() => runJob(job.id), index * 1000);
    });
  };

  return { runJob, stopJob, editJobOrder, runBatch };
};