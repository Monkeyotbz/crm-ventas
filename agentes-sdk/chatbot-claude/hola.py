from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv(override=True)  # lee ANTHROPIC_API_KEY desde .env (tiene prioridad sobre el entorno)
client = Anthropic()        # el SDK toma la llave del entorno

respuesta = client.messages.create(
    model="claude-haiku-5-5",
    max_tokens=300,
    messages=[
        {"role": "user", "content": "Hola, preséntate en una frase."}
    ],
)

print(respuesta.content[0].text)
print(respuesta.usage)
