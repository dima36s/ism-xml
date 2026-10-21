/* ИСМ XML — подключение к базе данных Supabase.
   Если поля пустые, приложение работает без входа: документы хранятся только в браузере.
   Если заполнены, вход обязателен: регистрация и вход по почте и паролю, у каждого пользователя свои документы.
   Ключ publishable (sb_publishable_…) или anon — публичный по замыслу Supabase: доступ к данным
   ограничивают политики Row Level Security из supabase/setup.sql.
   Секретный ключ (sb_secret_…, service_role) и пароль базы данных сюда класть нельзя. */
window.ISM_CONFIG = {
  supabaseUrl: 'https://oknunimfotakzbgfaspe.supabase.co',
  supabaseAnonKey: 'sb_publishable_hnJOAHTyip2yFixRFwMtyQ_UqwfcH65',
};
