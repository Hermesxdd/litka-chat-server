# Команды чата

## Команды настройки профиля

Все команды начинаются с `@custom`

### Стиль скобок
```
@custom bracket []
@custom bracket ()
@custom bracket {}
@custom bracket <>
@custom bracket ||
@custom bracket ««»»
```

### Цвет скобок
```
@custom bracketcolor §0  (черный)
@custom bracketcolor §1  (темно-синий)
@custom bracketcolor §2  (темно-зеленый)
@custom bracketcolor §3  (темно-бирюзовый)
@custom bracketcolor §4  (темно-красный)
@custom bracketcolor §5  (фиолетовый)
@custom bracketcolor §6  (золотой)
@custom bracketcolor §7  (серый)
@custom bracketcolor §8  (темно-серый)
@custom bracketcolor §9  (синий)
@custom bracketcolor §a  (зеленый)
@custom bracketcolor §b  (бирюзовый)
@custom bracketcolor §c  (красный)
@custom bracketcolor §d  (розовый)
@custom bracketcolor §e  (желтый)
@custom bracketcolor §f  (белый)
```

### Цвет сообщений
```
@custom messagecolor §X  (где X - код цвета из списка выше)
```

### Префиксы

Добавить префикс (до 6 символов, максимум 5 префиксов):
```
@custom prefix add VIP
@custom prefix add PRO
```

Список префиксов:
```
@custom prefix list
```

Выбрать префикс:
```
@custom prefix select 1
@custom prefix select 2
```

Удалить префикс:
```
@custom prefix remove 1
```

### Помощь
```
@custom help
```

## Примеры

1. Настроить красные скобки и зеленый текст:
```
@custom bracketcolor §c
@custom messagecolor §a
```

2. Добавить и выбрать префикс:
```
@custom prefix add VIP
@custom prefix select 1
```

3. Изменить стиль скобок:
```
@custom bracket <>
```

## Специальные ранги (выдаются администратором)

Администратор может выдать специальный ранг по HWID:

```bash
curl -X POST https://litka-chat-server.onrender.com/admin/rank \
  -H "Content-Type: application/json" \
  -d '{
    "adminKey": "litka-admin-2024",
    "hwid": "abc123",
    "rank": "Developer"
  }'
```

Доступные ранги:
- Developer
- Media
- Helper
- Moderator
- Admin
- Owner

## Формат сообщения

Обычный пользователь:
```
[Чат] [Player]: Привет!
```

С префиксом:
```
[Чат] [VIP] [Player]: Привет!
```

Со специальным рангом:
```
[Чат] [Developer] [Player]: Привет!
```

С кастомными настройками:
```
[Чат] [VIP] <Player>: Привет!  (красные скобки, зеленый текст)
```
