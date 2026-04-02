import React from 'react';
import { Command, X } from 'lucide-react';

const TestCommandsManagerModal = ({ 
  commands, 
  editingCommand, 
  commandForm, 
  setCommandForm, 
  onClose, 
  onSave, 
  onEdit, 
  onDelete, 
  onDuplicate 
}) => {
  const categories = ['testing', 'regression', 'power', 'security', 'boot', 'firmware', 'custom'];
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold">Manage Test Commands</h3>
            <p className="text-sm text-slate-500 mt-1">Add, edit, or delete your test commands</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Form Section */}
            <div className="space-y-4">
              <h4 className="font-bold text-lg">{editingCommand ? 'Edit Command' : 'Add New Command'}</h4>
              
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Command Name</label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., My Custom Test"
                  value={commandForm.name}
                  onChange={(e) => setCommandForm({ ...commandForm, name: e.target.value })}
                />
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Command</label>
                <textarea
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  rows="4"
                  placeholder="./my_test.sh --board {board_id} --option value"
                  value={commandForm.command}
                  onChange={(e) => setCommandForm({ ...commandForm, command: e.target.value })}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Use placeholders: <code className="bg-slate-100 px-1 rounded">{'{board_id}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{firmware}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{boards}'}</code>
                </p>
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Description</label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="What does this command do?"
                  value={commandForm.description}
                  onChange={(e) => setCommandForm({ ...commandForm, description: e.target.value })}
                />
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Category</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  value={commandForm.category}
                  onChange={(e) => setCommandForm({ ...commandForm, category: e.target.value })}
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              
              <button
                onClick={() => {
                  if (!commandForm.name || !commandForm.command) {
                    alert('Please fill in name and command');
                    return;
                  }
                  onSave(commandForm);
                }}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all"
              >
                {editingCommand ? 'Update Command' : 'Add Command'}
              </button>
              
              {editingCommand && (
                <button
                  onClick={() => {
                    setCommandForm({ name: '', command: '', description: '', category: 'testing' });
                    onEdit(null);
                  }}
                  className="w-full bg-slate-200 text-slate-700 py-3 rounded-xl font-bold hover:bg-slate-300 transition-all"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            
            {/* Commands List */}
            <div className="space-y-4">
              <h4 className="font-bold text-lg">Your Commands ({commands.length})</h4>
              
              {commands.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Command size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No commands yet. Add your first command!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {commands.map((cmd) => (
                    <div
                      key={cmd.id}
                      className={`p-4 rounded-xl border-2 ${
                        editingCommand?.id === cmd.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-slate-800">{cmd.name}</span>
                            <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-xs font-bold">
                              {cmd.category}
                            </span>
                          </div>
                          {cmd.description && (
                            <p className="text-sm text-slate-600 mb-2">{cmd.description}</p>
                          )}
                          <code className="text-xs text-slate-700 bg-white p-2 rounded border border-slate-200 block">
                            {cmd.command}
                          </code>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
                        <button
                          onClick={() => onEdit(cmd)}
                          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-200 transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onDuplicate(cmd.id)}
                          className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => onDelete(cmd.id)}
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 transition-all ml-auto"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Add Board Modal (frontend-only)

export default TestCommandsManagerModal;
