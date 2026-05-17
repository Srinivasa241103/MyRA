import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
export default class AnthropicStats {
  constructor() {}

  async calculateTokensPerMessage(message) {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const messageTokensCount = await client.messages.countTokens({
      messages: [{ constent: message.count, role: "user" }],
      model: CLAUDE_MODEL,
    });
  }

  async getCostReport() {
    const response = await axios.get(
      "https://api.anthropic.com/v1/organizations/cost_report ",
      {
        headers: {
          "anthropic-version": "2023-06-01",
          "X-Api-Key": process.env.ANTHROPIC_API_KEY,
        },
      }
    );

    if (!response) {
      throw error;
    }
    // write a funtion to convert usd to inr
    if (response.data) {
      const date = response.data.ending_at;
      response.data.results.forEach((element) => {
        const modelCostData = {
          remainingAmount: element.currency,
          model: element.model,
        };
      });
    }
  }
}
