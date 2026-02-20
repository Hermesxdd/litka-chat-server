# Быстрый старт

## 1. Деплой на Render.com (5 минут)

1. Загрузите папку `irc-server` на GitHub
2. Зайдите на https://render.com и зарегистрируйтесь
3. New + → Web Service → Выберите репозиторий
4. Настройки:
   - Build: `npm install`
   - Start: `npm start`
   - Plan: Free
5. Нажмите "Create Web Service"
6. Скопируйте URL (например: `https://litka-chat-server.onrender.com`)

## 2. Обновите клиент

В `src/java/client/irc/IRCClient.java` замените:

```java
private static final String SERVER_URL = "wss://your-app.onrender.com";
```

На ваш URL:

```java
private static final String SERVER_URL = "wss://litka-chat-server.onrender.com";
```

## 3. Готово!

Включите "IRC Чат" в настройках BetterMinecraft и общайтесь!

---

## Рекомендуемые бесплатные хостинги:

1. **Render.com** ⭐ (Лучший)
   - Полностью бесплатный
   - SSL из коробки
   - Простой деплой

2. **Railway.app**
   - $5 кредитов в месяц
   - Не засыпает
   - Требует карту

3. **Cyclic.sh**
   - Бесплатный
   - Не засыпает
   - Простой

4. **Fly.io**
   - Хороший free tier
   - Быстрый
   - Требует карту
