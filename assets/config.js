/* ИСМ XML — подключение к базе данных Supabase.
   Если поля пустые, приложение работает без входа: документы хранятся только в браузере.
   Если заполнены, вход обязателен: регистрация по почте с кодом, у каждого пользователя свои документы.
   Ключ anon — публичный по замыслу Supabase: доступ к данным ограничивают политики Row Level Security
   из supabase/setup.sql. Секретный ключ service_role сюда класть нельзя. */
window.ISM_CONFIG = {
  supabaseUrl: '',      // например https://abcdefghijklmnop.supabase.co
  supabaseAnonKey: '',  // Project Settings → API → Project API keys → anon public
};
