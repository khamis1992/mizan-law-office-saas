import { can } from '@/lib/permissions';
import { roleLabel } from '@/lib/office-utils';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Bell, Bot, BriefcaseBusiness, CalendarClock, ChevronLeft, FileSignature, LayoutDashboard, LogOut, Menu, SearchCheck, Search, UserPlus, Users, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { ReactNode, useEffect, useState } from 'react';
import { Brand } from '@/components/shell/brand';

/**
 * القشرة الجديدة كلياً لميزان المكتب: لا شريط جانبي إدارياً.
 * شريط علوي واحد: الهوية + تبويبات أفقية + زر البحث/الأوامر (⌘K) + بطاقة المستخدم،
 * والقضاء بشاشة كاملة العرض مع حركة دخول ناعمة لكل صفحة.
 */

type Page = 'dashboard' | 'cases' | 'schedule' | 'clients' | 'research' | 'contracts' | 'agents' | 'office';

type TabDef = { page: Page; label: string; icon: typeof LayoutDashboard; group: string };

const TABS: TabDef[] = [
  { page: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard, group: 'مكتب العمل' },
  { page: 'cases', label: 'القضايا', icon: BriefcaseBusiness, group: 'مكتب العمل' },
  { page: 'schedule', label: 'الجدول', icon: CalendarClock, group: 'مكتب العمل' },
  { page: 'clients', label: 'العملاء', icon: Users, group: 'مكتب العمل' },
  { page: 'research', label: 'بحث موثق', icon: SearchCheck, group: 'الذكاء القانوني' },
  { page: 'contracts', label: 'العقود', icon: FileSignature, group: 'الذكاء القانوني' },
  { page: 'agents', label: 'الوكلاء', icon: Bot, group: 'الذكاء القانوني' },
  { page: 'office', label: 'المكتب', icon: UserPlus, group: 'الإدارة' },
];

type AppNotification = { id: string; type: string; title: string; body: string | null; reference_url: string | null; is_read: boolean; created_at: string };

export default function AppShell({ profile, page, onNavigate, onOpenPalette, children }: {
  profile: { display_name: string; role: 'manager' | 'lawyer' | 'employee' };
  page: Page;
  onNavigate: (page: Page) => void;
  onOpenPalette: () => void;
  children: ReactNode;
}) {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const groups = Array.from(new Set(TABS.map(tab => tab.group)));

  const loadNotifications = async () => {
    const { data } = await supabase.from('notifications').select('id,type,title,body,reference_url,is_read,created_at').order('created_at', { ascending: false }).limit(20);
    setNotifications((data ?? []) as AppNotification[]);
  };
  useEffect(() => { loadNotifications(); const interval = setInterval(loadNotifications, 60000); return () => clearInterval(interval); }, []);

  const unread = notifications.filter(item => !item.is_read).length;

  const markAllRead = async () => {
    const ids = notifications.filter(item => !item.is_read).map(item => item.id);
    if (!ids.length) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', ids);
    setNotifications(current => current.map(item => ({ ...item, is_read: true })));
  };

  const openNotification = async (item: AppNotification) => {
    if (!item.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', item.id);
      setNotifications(current => current.map(entry => entry.id === item.id ? { ...entry, is_read: true } : entry));
    }
    setNotifOpen(false);
    if (item.reference_url?.startsWith('/cases/')) {
      const caseId = item.reference_url.slice('/cases/'.length);
      onNavigate('cases');
      window.history.pushState({}, '', `/cases/${caseId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenPalette]);

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f7f5]">
      <motion.header initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 26 }} className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[#e5ece9]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="h-16 flex items-center gap-4">
            <button className="lg:hidden p-2 -mr-2" onClick={() => setMobileMenu(true)}><Menu className="h-5 w-5" /></button>
            <Brand />
            <button
              onClick={onOpenPalette}
              className="hidden md:flex flex-1 max-w-md items-center gap-2.5 h-10 rounded-full border border-[#e5ece9] bg-[#f4f7f5] px-4 text-sm text-muted-foreground hover:bg-[#eaf3ef] hover:border-[#d3e4dd] transition-colors"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-right">ابحث في قضايا ومواعيد ومهام المكتب…</span>
              <kbd className="text-[10px] font-sans font-bold bg-white border border-[#e5ece9] rounded-md px-1.5 py-0.5 text-[#5d716c]">Ctrl K</kbd>
            </button>
            <button onClick={onOpenPalette} className="md:hidden p-2 text-[#1b6258]"><Search className="h-5 w-5" /></button>
            <div className="flex-1" />
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <button className="relative p-2 text-muted-foreground hover:text-[#1b6258]" title="مركز الإشعارات" onClick={() => setNotifOpen(open => !open)}>
                  <Bell className="h-5 w-5" />
                  {unread > 0 && <span className="absolute top-0.5 right-0.5 h-4 min-w-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold grid place-items-center">{unread}</span>}
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <div className="absolute left-0 top-11 z-50 w-80 sm:w-96 rounded-2xl border border-[#e5ece9] bg-white shadow-2xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-[#e5ece9] flex items-center justify-between">
                        <p className="font-bold text-sm text-[#153a36]">مركز الإشعارات</p>
                        {unread > 0 && <button className="text-[11px] font-semibold text-[#1b6258] hover:underline" onClick={markAllRead}>تحديد الكل كمقروء</button>}
                      </div>
                      <div className="max-h-96 overflow-y-auto divide-y divide-[#f4f7f5]">
                        {notifications.length ? notifications.map(item => (
                          <button key={item.id} onClick={() => openNotification(item)} className={`w-full text-right px-4 py-3 hover:bg-[#f8fbfa] ${!item.is_read ? 'bg-[#f0f7f4]' : ''}`}>
                            <p className="text-sm font-semibold text-[#153a36] flex items-center gap-2">
                              {!item.is_read && <span className="h-1.5 w-1.5 rounded-full bg-[#b58524] shrink-0" />}
                              {item.title}
                            </p>
                            {item.body && <p className="text-xs text-muted-foreground mt-1 leading-5 line-clamp-2">{item.body}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">{new Date(item.created_at).toLocaleString('ar-QA')}</p>
                          </button>
                        )) : <p className="py-10 text-center text-sm text-muted-foreground">لا إشعارات بعد.</p>}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-semibold leading-tight text-[#153a36] truncate max-w-[140px]">{profile.display_name}</p>
                <p className="text-[11px] text-muted-foreground">{roleLabel(profile.role)}</p>
              </div>
              <div className="h-9 w-9 rounded-full bg-[#0d3b36] text-[#e8c377] grid place-items-center font-semibold shrink-0">{profile.display_name.charAt(0)}</div>
              <button className="p-2 text-muted-foreground hover:text-rose-600" title="تسجيل الخروج" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto" style={{ height: 44 }}>
            {groups.map((group, groupIndex) => (
              <div key={group} className="flex items-center gap-1">
                {groupIndex > 0 && <span className="w-px h-4 bg-[#e5ece9] mx-2 shrink-0" />}
                {TABS.filter(tab => tab.group === group).map((tab, tabIndex) => {
                  const Icon = tab.icon;
                  const active = page === tab.page;
                  return (
                    <motion.button
                      key={tab.page}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + tabIndex * 0.03 }}
                      onClick={() => onNavigate(tab.page)}
                      className={cn(
                        'relative h-full flex items-center gap-1.5 px-3 text-sm whitespace-nowrap transition-colors',
                        active ? 'text-[#145348] font-bold' : 'text-[#5d716c] hover:text-[#153a36]',
                        tab.group === 'الذكاء القانوني' && !active && 'text-[#8d6515]',
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5', active ? 'text-[#b58524]' : '')} />
                      {tab.label}
                      {active && <span className="absolute bottom-0 right-2 left-2 h-0.5 rounded-full bg-[#b58524]" />}
                    </motion.button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </motion.header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <motion.div key={page} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 24 }}>{children}</motion.div>
      </main>

      {mobileMenu && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[#092a26]/40" onClick={() => setMobileMenu(false)} />
          <div className="absolute inset-y-0 right-0 w-72 bg-white p-4 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center mb-4"><Brand /><button className="p-2" onClick={() => setMobileMenu(false)}><X className="h-5 w-5" /></button></div>
            <div className="flex-1 overflow-y-auto space-y-4">
              {groups.map(group => (
                <div key={group}>
                  <p className="px-3 pb-1 text-[11px] font-bold tracking-wide text-muted-foreground">{group}</p>
                  <div className="space-y-1">
                    {TABS.filter(tab => tab.group === group).map((tab, tabIndex) => {
                      const Icon = tab.icon;
                      return (
                        <button key={tab.page} className={cn('w-full h-11 flex items-center gap-3 px-3 rounded-xl text-sm', page === tab.page ? 'bg-[#e9f2ef] text-[#145348] font-semibold' : 'text-[#5d716c] hover:bg-[#f4f7f5]')} onClick={() => { onNavigate(tab.page); setMobileMenu(false); }}>
                          <Icon className={cn('h-4 w-4', page === tab.page ? 'text-[#b58524]' : '')} />{tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => { setMobileMenu(false); onOpenPalette(); }} className="w-full h-11 mb-2 rounded-xl bg-[#f4f7f5] border border-[#e5ece9] flex items-center justify-center gap-2 text-sm text-[#1b6258]"><Search className="h-4 w-4" />البحث والأوامر</button>
            <button onClick={() => supabase.auth.signOut()} className="w-full h-11 rounded-xl border flex items-center justify-center gap-2 text-sm text-rose-700"><LogOut className="h-4 w-4" />تسجيل الخروج</button>
          </div>
        </div>
      )}

      <style>{`@keyframes shellFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
