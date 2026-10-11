# Настройка рабочего окружения

## 1. Установка Cline

1. Открыть VS Code → Extensions (`Ctrl+Shift+X`).
2. Найти **«Cline»** (автор: Cline Bot Inc.).
3. Установить → перезагрузить VS Code.
4. В левой панели появится иконка Cline (робот).

## 2. Настройка LLM-провайдера

### Вариант А: DeepSeek API 

1. Зарегистрироваться на [platform.deepseek.com].
2. Получить API-ключ.
3. В настройках Cline:
   - **API Provider:** DeepSeek
   - **API Key:** `<ваш_ключ>`
   - **Model:** `deepseek-coder` или `deepseek-chat`
4. Сохранить.

### Вариант Б: Ollama (полностью on-premise)

1. Установить [Ollama](https://ollama.com/).
2. Скачать модель: `ollama pull deepseek-coder:6.7b`.
3. В настройках Cline:
   - **API Provider:** Ollama
   - **Base URL:** `http://localhost:11434`
   - **Model:** `deepseek-coder:6.7b`

## 3. Настройка MCP (Model Context Protocol)

Для доступа к MySQL через MCP (опционально):

1. Установить: `npm install -g @modelcontextprotocol/server-mysql`.
2. В настройках Cline → MCP Servers → добавить:
   ```json
   {
     "mysql": {
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-mysql"],
       "env": {
         "MYSQL_HOST": "localhost",
         "MYSQL_USER": "salon",
         "MYSQL_PASSWORD": "salonpass",
         "MYSQL_DATABASE": "salon"
       }
     }
   }
