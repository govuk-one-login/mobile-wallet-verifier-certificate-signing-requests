export const handler = async (event: unknown): Promise<void> => {
  console.log('CSR validator invoked', JSON.stringify(event));
};
