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
    "https://fgsi.dpdns.org/api/ai/claude",
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
      model: "anthropic/claude-opus-4.8",
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

// Logika sendiri lah woy 🗿🔪
