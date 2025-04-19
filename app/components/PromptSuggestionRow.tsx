import PromptSuggestionButton from "./PromptSuggestionButton"

const PromptSuggestionRow = ({onPromptClick}) => {
    const prompts = [
        "Who is the head of racing for Aston Martin's F1 Academy team?",
        "Who is the highest paid driver in F1?",
        "Who will be the newest driver for Ferrari?",
        "Who is the current Formula 1 World Driver's Champion?"
    ]
    return(
        <div className="prompt-suuggestion-row">
            {prompts.map((prompt, index) => 
            <PromptSuggestionButton 
            key={`suggestion-${index}`}
            text={prompt}
            onClick= {() => onPromptClick(prompt)}
            />)}        
        </div>
    )
}

export default PromptSuggestionRow