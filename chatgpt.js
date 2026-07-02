/***
 *** ᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁
 *** - Dev: FongsiDev
 *** - Contact: t.me/dashmodz
 *** - Gmail: fongsiapi@gmail.com & fgsidev@neko2.net
 *** - Saluran WhatsApp: whatsapp.com/channel/0029VapkSr45q08hPPPVqy26
 *** - Telegram Group: t.me/fongsidev
 *** - Github: github.com/Fgsi-APIs/RestAPIs/issues/new
 *** - Website: fgsi.koyeb.app
 *** ᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁᠁
 ***/

import axios from "axios";
try {
  const response = await axios.post(
    "https://fgsi.dpdns.org/api/ai/chatgpt",
    {
      apikey: "fgsiapi-d404754-6d",
      messages: [
        {
          id: 123456789,
          role: "user",
          parts: [
            {
              type: "text",
              text: "Hello",
            },
          ],
        },
      ],
      model: "",
      isDeepResearchMode: false,
      isWebSearchMode: false,
      isImageGenerationMode: false,
      isAgenticMode: false,
    },
    {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
    },
  );
  console.log(response.data);
} catch (error) {
  console.error(error.response?.data || error.message);
}
// body
// apikey, messages, model(openai/gpt-5.1-thinking, openai/gpt-5-chat:online, openai/gpt-5-chat, openai/gpt-5-nano, openai/gpt-5-mini, openai/o1, openai/o3, openai/o3-mini, openai/gpt-4o, openai/gpt-5-nano, openai/o4-mini, openai/gpt-4-1-mini, openai/gpt-4-1-nano, openai/gpt-5.3-chat, openai/gpt-5.4, openai/gpt-5.5), isDeepResearchMode, isWebSearchMode, isImageGenerationMode, isAgenticMode
