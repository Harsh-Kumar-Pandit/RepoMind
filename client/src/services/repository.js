import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

export async function analyzeRepository(url) {
  const { data } = await api.post("/repositories/analyze", {
    url,
  });

  return data;
}