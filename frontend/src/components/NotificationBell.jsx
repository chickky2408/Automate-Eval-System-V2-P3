import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useTestStore } from '../store/useTestStore';

const NotificationItem = ({ notification, onClick }) => {
  const typeColor = (type) => {
    switch (type) {
      case 'success':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-red-500';
      case 'info':
        return 'bg-blue-500';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <div
      className={`flex gap-4 items-start p-3 border-b border-slate-100 cursor-pointer transition-all ${
        !notification.read ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-slate-50'
      }`}
      onClick={onClick}
    >
      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${typeColor(notification.type)}`} />
      <div className="flex-1">
        <div className={`text-sm font-bold leading-none mb-1 ${!notification.read ? 'text-slate-900' : 'text-slate-700'}`}>
          {notification.title}
        </div>
        <div className="text-xs text-slate-500 mb-1">{notification.message}</div>
        <div className="text-[10px] text-slate-400 font-bold">{notification.time}</div>
      </div>
      {!notification.read && <div className="h-2 w-2 bg-blue-500 rounded-full shrink-0 mt-1" />}
    </div>
  );
};

const NotificationBell = () => {
  const { notifications, localNotifications, markNotificationRead, markAllNotificationsRead, loading, errors } = useTestStore();
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef(null);

  const mergedNotifications = useMemo(() => {
    const merged = [
      ...(localNotifications || []).map((n) => ({ ...n, time: n.createdAt ? 'just now' : undefined })),
      ...(notifications || []),
    ];
    merged.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt) : new Date(0);
      const tB = b.createdAt ? new Date(b.createdAt) : new Date(0);
      return tB - tA;
    });
    return merged;
  }, [localNotifications, notifications]);

  const unreadCount = mergedNotifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  return (
    <div className="relative" ref={notificationRef}>
      <button
        type="button"
        onClick={() => setShowNotifications((v) => !v)}
        className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
        title="Notifications"
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full" />
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 max-h-[600px] flex flex-col">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-800">Notifications</h3>
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={() => markAllNotificationsRead()} className="text-xs text-blue-600 font-bold hover:text-blue-800">
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto max-h-[500px]">
            {loading?.notifications ? (
              <div className="p-8 text-center text-slate-400">
                <Bell size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Loading notifications...</p>
              </div>
            ) : errors?.notifications ? (
              <div className="p-8 text-center text-red-600">
                <Bell size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Failed to load notifications</p>
              </div>
            ) : mergedNotifications.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <Bell size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {mergedNotifications.map((notif) => (
                  <NotificationItem
                    key={notif.id || `${notif.title}-${notif.createdAt || ''}`}
                    notification={notif}
                    onClick={() => {
                      if (notif.id != null) markNotificationRead(notif.id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

