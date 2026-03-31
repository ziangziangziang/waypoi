export interface TinyQaRow {
  id: number;
  question: string;
  answer: string;
  context: string;
  category: string;
  difficulty: string;
}

// Source: https://huggingface.co/datasets/vincentkoc/tiny_qa_benchmark (train split)
export const TINY_QA_BENCHMARK: TinyQaRow[] = [
  {
    "id": 1,
    "question": "What is the capital of France?",
    "answer": "Paris",
    "context": "France is a country in Europe. Its capital is Paris.",
    "category": "geography",
    "difficulty": "easy"
  },
  {
    "id": 2,
    "question": "Who wrote Romeo and Juliet?",
    "answer": "William Shakespeare",
    "context": "Romeo and Juliet is a famous play written by William Shakespeare.",
    "category": "literature",
    "difficulty": "easy"
  },
  {
    "id": 3,
    "question": "What is 2 + 2?",
    "answer": "4",
    "context": "Basic arithmetic: 2 + 2 equals 4.",
    "category": "math",
    "difficulty": "easy"
  },
  {
    "id": 4,
    "question": "What is the largest planet in our solar system?",
    "answer": "Jupiter",
    "context": "Jupiter is the largest planet in our solar system.",
    "category": "astronomy",
    "difficulty": "easy"
  },
  {
    "id": 5,
    "question": "Who painted the Mona Lisa?",
    "answer": "Leonardo da Vinci",
    "context": "The Mona Lisa was painted by Leonardo da Vinci.",
    "category": "art",
    "difficulty": "easy"
  },
  {
    "id": 6,
    "question": "What is the derivative of sin(x)?",
    "answer": "cos(x)",
    "context": "In differential calculus, the derivative of sin(x) with respect to x is cos(x).",
    "category": "calculus",
    "difficulty": "medium"
  },
  {
    "id": 7,
    "question": "Who discovered penicillin?",
    "answer": "Alexander Fleming",
    "context": "Penicillin was discovered in 1928 by Alexander Fleming.",
    "category": "biology",
    "difficulty": "medium"
  },
  {
    "id": 8,
    "question": "What is 5 factorial?",
    "answer": "120",
    "context": "By definition, 5! = 5 × 4 × 3 × 2 × 1 = 120.",
    "category": "math",
    "difficulty": "easy"
  },
  {
    "id": 9,
    "question": "In what year did the Berlin Wall fall?",
    "answer": "1989",
    "context": "The Berlin Wall fell on November 9, 1989, marking the beginning of German reunification.",
    "category": "history",
    "difficulty": "medium"
  },
  {
    "id": 10,
    "question": "What is the time complexity of binary search on a sorted array?",
    "answer": "O(log n)",
    "context": "Binary search splits the search interval in half each step, giving logarithmic time complexity.",
    "category": "computer science",
    "difficulty": "medium"
  },
  {
    "id": 11,
    "question": "What is the atomic number of carbon?",
    "answer": "6",
    "context": "On the periodic table, carbon has atomic number 6.",
    "category": "chemistry",
    "difficulty": "easy"
  },
  {
    "id": 12,
    "question": "What is the speed of light in vacuum (m/s)?",
    "answer": "299792458",
    "context": "By definition, the speed of light in vacuum is exactly 299,792,458 m/s.",
    "category": "physics",
    "difficulty": "medium"
  },
  {
    "id": 13,
    "question": "What does HTTP stand for?",
    "answer": "Hypertext Transfer Protocol",
    "context": "HTTP is the foundation of data communication for the World Wide Web.",
    "category": "computer science",
    "difficulty": "easy"
  },
  {
    "id": 14,
    "question": "What year did Apollo 11 land on the Moon?",
    "answer": "1969",
    "context": "Apollo 11 landed on the Moon on July 20, 1969.",
    "category": "history",
    "difficulty": "medium"
  },
  {
    "id": 15,
    "question": "What is Euler’s identity?",
    "answer": "e^(iπ) + 1 = 0",
    "context": "Euler’s identity is often cited as an example of mathematical beauty.",
    "category": "math",
    "difficulty": "medium"
  },
  {
    "id": 16,
    "question": "What is the boiling point of water at sea level (°C)?",
    "answer": "100",
    "context": "At standard atmospheric pressure, water boils at 100 °C.",
    "category": "chemistry",
    "difficulty": "easy"
  },
  {
    "id": 17,
    "question": "What is the capital of Nigeria?",
    "answer": "Abuja",
    "context": "Nigeria is a country in West Africa. Its capital is Abuja.",
    "category": "geography",
    "difficulty": "easy"
  },
  {
    "id": 18,
    "question": "What is the capital of Australia?",
    "answer": "Canberra",
    "context": "Australia’s capital city is Canberra.",
    "category": "geography",
    "difficulty": "easy"
  },
  {
    "id": 19,
    "question": "What is the capital of Japan?",
    "answer": "Tokyo",
    "context": "Japan’s capital city is Tokyo.",
    "category": "geography",
    "difficulty": "easy"
  },
  {
    "id": 20,
    "question": "What is the square root of 81?",
    "answer": "9",
    "context": "The square root of 81 is 9.",
    "category": "math",
    "difficulty": "easy"
  },
  {
    "id": 21,
    "question": "What is the value of π to two decimal places?",
    "answer": "3.14",
    "context": "Pi (π) is approximately 3.14159…, which rounds to 3.14 at two decimal places.",
    "category": "math",
    "difficulty": "easy"
  },
  {
    "id": 22,
    "question": "What is the sum of the interior angles of a triangle in degrees?",
    "answer": "180",
    "context": "In Euclidean geometry, the interior angles of any triangle add up to 180 degrees.",
    "category": "math",
    "difficulty": "easy"
  },
  {
    "id": 23,
    "question": "Solve for x: x² - 4 = 0",
    "answer": "x = 2 or x = -2",
    "context": "The equation x² - 4 = 0 factors to (x - 2)(x + 2) = 0, so x = 2 or x = -2.",
    "category": "math",
    "difficulty": "easy"
  },
  {
    "id": 24,
    "question": "How many seconds are in one hour?",
    "answer": "3600",
    "context": "60 seconds × 60 minutes = 3600 seconds in one hour.",
    "category": "time",
    "difficulty": "easy"
  },
  {
    "id": 25,
    "question": "How many minutes are in a day?",
    "answer": "1440",
    "context": "24 hours × 60 minutes = 1440 minutes in a day.",
    "category": "time",
    "difficulty": "easy"
  },
  {
    "id": 26,
    "question": "How many hours are in a week?",
    "answer": "168",
    "context": "7 days × 24 hours = 168 hours in a week.",
    "category": "time",
    "difficulty": "easy"
  },
  {
    "id": 27,
    "question": "How many months have 31 days?",
    "answer": "7",
    "context": "January, March, May, July, August, October, and December each have 31 days.",
    "category": "calendar",
    "difficulty": "easy"
  },
  {
    "id": 28,
    "question": "Which galaxy is Earth located in?",
    "answer": "The Milky Way",
    "context": "Our Solar System resides in the Milky Way galaxy.",
    "category": "astronomy",
    "difficulty": "easy"
  },
  {
    "id": 29,
    "question": "What is the formula for kinetic energy?",
    "answer": "½mv²",
    "context": "Kinetic energy is defined as one-half mass times velocity squared.",
    "category": "physics",
    "difficulty": "medium"
  },
  {
    "id": 30,
    "question": "What is Newton’s second law of motion?",
    "answer": "F = ma",
    "context": "Newton’s second law states that force equals mass times acceleration.",
    "category": "physics",
    "difficulty": "medium"
  },
  {
    "id": 31,
    "question": "What is the standard acceleration due to gravity on Earth (m/s²)?",
    "answer": "9.81",
    "context": "Standard gravity is defined as 9.81 m/s².",
    "category": "physics",
    "difficulty": "medium"
  },
  {
    "id": 32,
    "question": "Which formula expresses mass–energy equivalence?",
    "answer": "E = mc²",
    "context": "Einstein’s mass–energy equivalence formula is E = mc².",
    "category": "physics",
    "difficulty": "medium"
  },
  {
    "id": 33,
    "question": "What is the powerhouse of the cell?",
    "answer": "Mitochondria",
    "context": "Mitochondria generate most of the cell’s supply of ATP and are known as the powerhouse of the cell.",
    "category": "biology",
    "difficulty": "easy"
  },
  {
    "id": 34,
    "question": "What molecule carries genetic information in most living organisms?",
    "answer": "DNA",
    "context": "Deoxyribonucleic acid (DNA) holds genetic blueprints for living organisms.",
    "category": "biology",
    "difficulty": "easy"
  },
  {
    "id": 35,
    "question": "Who wrote the novel 1984?",
    "answer": "George Orwell",
    "context": "1984 is a dystopian novel authored by George Orwell and published in 1949.",
    "category": "literature",
    "difficulty": "easy"
  },
  {
    "id": 36,
    "question": "Who wrote To Kill a Mockingbird?",
    "answer": "Harper Lee",
    "context": "To Kill a Mockingbird is a Pulitzer Prize–winning novel by Harper Lee.",
    "category": "literature",
    "difficulty": "easy"
  },
  {
    "id": 37,
    "question": "Who was the first President of the United States?",
    "answer": "George Washington",
    "context": "George Washington served as the first U.S. President from 1789 to 1797.",
    "category": "history",
    "difficulty": "easy"
  },
  {
    "id": 38,
    "question": "In which year did World War I begin?",
    "answer": "1914",
    "context": "World War I started on July 28, 1914.",
    "category": "history",
    "difficulty": "medium"
  },
  {
    "id": 39,
    "question": "In which year did World War II end?",
    "answer": "1945",
    "context": "World War II concluded on September 2, 1945.",
    "category": "history",
    "difficulty": "medium"
  },
  {
    "id": 40,
    "question": "What is the smallest country in the world by area?",
    "answer": "Vatican City",
    "context": "Vatican City covers about 44 hectares and is the world’s smallest independent state.",
    "category": "geography",
    "difficulty": "medium"
  },
  {
    "id": 41,
    "question": "Which element has the chemical symbol Au?",
    "answer": "Gold",
    "context": "Au comes from the Latin name aurum for the metal gold.",
    "category": "chemistry",
    "difficulty": "easy"
  },
  {
    "id": 42,
    "question": "What does GDP stand for?",
    "answer": "Gross Domestic Product",
    "context": "GDP measures the total market value of all final goods and services produced in a country.",
    "category": "economics",
    "difficulty": "medium"
  },
  {
    "id": 43,
    "question": "What is the currency of Japan?",
    "answer": "Yen",
    "context": "The official currency of Japan is the Yen (¥).",
    "category": "economics",
    "difficulty": "easy"
  },
  {
    "id": 44,
    "question": "What is the output of print(len([1, 2, 3])) in Python?",
    "answer": "3",
    "context": "len([1, 2, 3]) returns the number of items in the list, which is 3.",
    "category": "computer science",
    "difficulty": "easy"
  },
  {
    "id": 45,
    "question": "In Python, what keyword is used to define a function?",
    "answer": "def",
    "context": "The def keyword introduces a function definition in Python.",
    "category": "computer science",
    "difficulty": "easy"
  },
  {
    "id": 46,
    "question": "In JavaScript, what keyword declares a variable with block scope?",
    "answer": "let",
    "context": "let declares a block-scoped local variable in JavaScript.",
    "category": "computer science",
    "difficulty": "easy"
  },
  {
    "id": 47,
    "question": "What is the average-case time complexity of quicksort?",
    "answer": "O(n log n)",
    "context": "Quicksort on average partitions arrays in half each recursion, yielding O(n log n).",
    "category": "computer science",
    "difficulty": "medium"
  },
  {
    "id": 48,
    "question": "If P implies Q and Q implies R, does P imply R?",
    "answer": "Yes",
    "context": "By transitivity of implication, if P ⇒ Q and Q ⇒ R, then P ⇒ R.",
    "category": "logic",
    "difficulty": "medium"
  },
  {
    "id": 49,
    "question": "If all cats are mammals and some mammals are black, can we conclude that some cats are black?",
    "answer": "No",
    "context": "The premises do not guarantee any overlap between cats and the subset of black mammals.",
    "category": "logic",
    "difficulty": "medium"
  },
  {
    "id": 50,
    "question": "What is the binary representation of decimal 10?",
    "answer": "1010",
    "context": "10 in base-10 converts to 1010 in base-2.",
    "category": "computer science",
    "difficulty": "easy"
  },
  {
    "id": 51,
    "question": "In git, what command stages changes for commit?",
    "answer": "git add",
    "context": "git add adds changes in the working directory to the staging area.",
    "category": "computer science",
    "difficulty": "medium"
  },
  {
    "id": 52,
    "question": "What is Big O notation used for?",
    "answer": "Describing algorithm complexity",
    "context": "Big O notation characterizes an algorithm’s performance in terms of input size.",
    "category": "computer science",
    "difficulty": "medium"
  }
];
