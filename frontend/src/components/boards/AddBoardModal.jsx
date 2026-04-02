import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useTestStore } from '../../store/useTestStore';

const AddBoardModal = ({ onClose }) => {
  const { addBoard } = useTestStore();
  const addToast = useTestStore((state) => state.addToast);
  const [form, setForm] = useState({
    name: '',
    status: 'online',
    ip: '',
    mac: '',
    firmware: 'v0.0.0',
    model: 'STM32',
    tag: '',
    connections: 'REST API, SSH',
    availability: 'available',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValidIp = (value) => {
    const ipRegex = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    return ipRegex.test(value);
  };

  const isValidMac = (value) => {
    const macRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
    return macRegex.test(value);
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Name is required.';
    if (form.ip && !isValidIp(form.ip)) nextErrors.ip = 'Invalid IP address.';
    if (form.mac && !isValidMac(form.mac)) nextErrors.mac = 'Invalid MAC address.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submit = async () => {
    if (isSubmitting) return;
    setFormError('');
    if (!validate()) return;
    setIsSubmitting(true);
    const created = await addBoard({
      name: form.name.trim(),
      status: form.status,
      ip: form.ip.trim(),
      mac: form.mac.trim(),
      firmware: form.firmware,
      model: form.model,
      tag: form.tag.trim(),
      connections: form.connections.split(',').map(s => s.trim()).filter(Boolean),
    });
    setIsSubmitting(false);
    if (created) {
      addToast({ type: 'success', message: 'Board added successfully.' });
      onClose();
    } else {
      setFormError('Failed to add board.');
      addToast({ type: 'error', message: 'Failed to add board.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-xl font-bold">Add Board</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">Name</label>
              <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder="Board #11"
              />
              {errors.name && <div className="text-xs text-red-600 mt-1">{errors.name}</div>}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">Status</label>
              <select className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl"
                value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="online">online</option>
                <option value="busy">busy</option>
                <option value="error">error</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">Availability</label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, availability: 'available' })}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border ${
                    form.availability === 'available'
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                      : 'bg-white text-slate-600 border-slate-300'
                  }`}
                >
                  Available
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, availability: 'disabled' })}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border ${
                    form.availability === 'disabled'
                      ? 'bg-slate-200 text-slate-800 border-slate-400'
                      : 'bg-white text-slate-600 border-slate-300'
                  }`}
                >
                  Disabled
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">IP</label>
              <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
                value={form.ip}
                onChange={(e) => {
                  setForm({ ...form, ip: e.target.value });
                  if (errors.ip) setErrors((prev) => ({ ...prev, ip: '' }));
                }}
                placeholder="192.168.1.111"
              />
              {errors.ip && <div className="text-xs text-red-600 mt-1">{errors.ip}</div>}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">MAC</label>
              <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
                value={form.mac}
                onChange={(e) => {
                  setForm({ ...form, mac: e.target.value });
                  if (errors.mac) setErrors((prev) => ({ ...prev, mac: '' }));
                }}
                placeholder="00:1B:44:..."
              />
              {errors.mac && <div className="text-xs text-red-600 mt-1">{errors.mac}</div>}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">Model</label>
              <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
                value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase">Firmware</label>
              <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
                value={form.firmware} onChange={(e) => setForm({ ...form, firmware: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase">Board Tag</label>
            <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
              value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="Line A / RMA" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase">Connections (comma separated)</label>
            <input className="w-full mt-1 bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none"
              value={form.connections} onChange={(e) => setForm({ ...form, connections: e.target.value })} />
          </div>
          {formError && (
            <div className="text-sm text-red-600">{formError}</div>
          )}
        </div>
        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isSubmitting}
            className={`px-4 py-2 bg-blue-600 text-white rounded-lg font-bold ${isSubmitting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-700'}`}
          >
            {isSubmitting ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
};



export default AddBoardModal;
