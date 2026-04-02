// src/components/JobManagement/JobCard.jsx
const JobCard = ({ job, onStop, onRun }) => {
    return (
      <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-blue-500 shadow-lg">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h4 className="text-sm font-bold">Job #{job.id.slice(0, 5)}</h4>
            <p className="text-xs text-gray-400">Status: {job.status}</p>
          </div>
        </div>
        
        {/* progress bar */}
        <div className="w-full bg-gray-700 h-1.5 rounded-full mb-4">
          <div className={`h-full rounded-full ${job.status === 'running' ? 'bg-green-500' : 'bg-gray-500'}`} style={{width: job.progress + '%'}}></div>
        </div>
  
        <div className="flex gap-2">
          <button onClick={() => onRun(job.id)} className="flex-1 bg-green-600/20 text-green-400 py-1 rounded text-xs hover:bg-green-600 hover:text-white transition-all">RUN</button>
          <button onClick={() => onStop(job.id)} className="flex-1 bg-red-600/20 text-red-400 py-1 rounded text-xs hover:bg-red-600 hover:text-white transition-all">STOP</button>
        </div>
      </div>
    );
  };