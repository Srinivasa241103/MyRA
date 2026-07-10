import axios from "axios";

export const usdToInr = async () => {
  const response = await axios.get(
    "https://api.frankfurter.app/latest?from=USD&to=INR"
  );
  return response.data.rates.INR;
};
