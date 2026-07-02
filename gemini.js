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
    "https://fgsi.dpdns.org/api/ai/gemini",
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

// Body apikey, messages, model(google/gemini-2.5-flash, google/gemini-2.5-pro, google/gemini-2.5-flash-image, google/gemini-3-pro-preview, google/gemini-3-pro-image-preview, google/gemini-3.1-pro), isDeepResearchMode, isWebSearchMode, isImageGenerationMode, isAgenticMode
